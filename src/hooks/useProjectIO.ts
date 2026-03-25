import { useCallback } from 'react';
import { Dancer, Keyframe } from '../types';
import { isTauri } from '../utils/platform';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

interface ProjectData {
  version: 1;
  projectName: string;
  dancers: Dancer[];
  keyframes: Keyframe[];
  duration: number;
  audioFileName: string | null;
}

export interface ProjectIOAPI {
  saveProject: (params: {
    projectName: string;
    dancers: Dancer[];
    keyframes: Keyframe[];
    duration: number;
    audioFileName: string | null;
  }) => Promise<void>;
  loadProject: (callbacks: {
    setProjectName: (name: string) => void;
    setDancers: (dancers: Dancer[]) => void;
    setKeyframes: (keyframes: Keyframe[]) => void;
    setDuration: (ms: number) => void;
    setAudioFileName: (name: string | null) => void;
    setAudioFile: (url: string | null) => void;
    setAudioBuffer: (buffer: null) => void;
    setHistory: (state: any) => void;
  }) => Promise<void>;
}

export function useProjectIO(): ProjectIOAPI {
  const saveProject = useCallback(async (params: {
    projectName: string;
    dancers: Dancer[];
    keyframes: Keyframe[];
    duration: number;
    audioFileName: string | null;
  }) => {
    try {
      const { projectName, dancers, keyframes, duration, audioFileName } = params;
      const projectData: ProjectData = {
        version: 1,
        projectName,
        dancers,
        keyframes,
        duration,
        audioFileName,
      };

      const json = JSON.stringify(projectData, null, 2);

      if (isTauri()) {
        const filePath = await save({
          defaultPath: `${projectName}.json`,
          filters: [{ name: 'ChoreoGraph Project', extensions: ['json'] }],
        });
        if (filePath) {
          await writeTextFile(filePath, json);
          alert('Project saved successfully!');
        }
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Failed to save project:', e);
      alert('Failed to save project.');
    }
  }, []);

  const loadProject = useCallback(async (callbacks: {
    setProjectName: (name: string) => void;
    setDancers: (dancers: Dancer[]) => void;
    setKeyframes: (keyframes: Keyframe[]) => void;
    setDuration: (ms: number) => void;
    setAudioFileName: (name: string | null) => void;
    setAudioFile: (url: string | null) => void;
    setAudioBuffer: (buffer: null) => void;
    setHistory: (state: any) => void;
  }) => {
    try {
      const applyData = (data: any) => {
        if (data.version === 1) {
          callbacks.setProjectName(data.projectName || 'Untitled Project');
          callbacks.setDancers(data.dancers || []);
          callbacks.setKeyframes(data.keyframes || []);
          callbacks.setDuration(data.duration || 30000);
          callbacks.setAudioFileName(data.audioFileName || null);
          callbacks.setAudioFile(null);
          callbacks.setAudioBuffer(null);
          callbacks.setHistory({
            dancers: data.dancers || [],
            keyframes: data.keyframes || [],
            groups: [],
          });
          alert(`Project loaded! Please re-upload audio: ${data.audioFileName || 'None'}`);
        } else {
          alert('Unknown project version.');
        }
      };

      if (isTauri()) {
        const filePath = await open({
          filters: [{ name: 'ChoreoGraph Project', extensions: ['json'] }],
        });
        if (filePath && typeof filePath === 'string') {
          const content = await readTextFile(filePath);
          const data = JSON.parse(content);
          applyData(data);
        }
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            const text = await file.text();
            const data = JSON.parse(text);
            applyData(data);
          }
        };
        input.click();
      }
    } catch (e) {
      console.error('Failed to load project:', e);
      alert('Failed to load project.');
    }
  }, []);

  return { saveProject, loadProject };
}
