import { useState, useRef, useCallback, useEffect } from 'react';
import { StageRef } from '../components/Stage';
import { getBestMimeType, getExtensionFromMime, generateRecordingFilename, getBrowserInfo, isTauri } from '../utils/platform';
import { downloadBlob } from '../utils/file';

export interface RecordingAPI {
  isRecording: boolean;
  startRecording: (
    stageRef: React.RefObject<StageRef | null>,
    audioDestNode: MediaStreamAudioDestinationNode | null,
    audioRef: React.RefObject<HTMLAudioElement | null>,
    audioFile: string | null,
  ) => void;
  stopRecording: () => void;
}

export function useRecording(projectName: string): RecordingAPI {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioElementSourceRef = useRef<{ audioCtx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback((
    stageRef: React.RefObject<StageRef | null>,
    audioDestNode: MediaStreamAudioDestinationNode | null,
    audioRef: React.RefObject<HTMLAudioElement | null>,
    audioFile: string | null,
  ) => {
    if (!stageRef.current) {
      alert('Stage not available for recording.');
      return;
    }

    // Get canvas stream
    const canvasStream = stageRef.current.getCanvasStream();
    const tracks = canvasStream.getVideoTracks();

    // Add audio track if available
    if (audioDestNode && audioFile) {
      const audioTracks = audioDestNode.stream.getAudioTracks();
      tracks.push(...audioTracks);
    }

    const stream = new MediaStream(tracks);
    const includeAudio = !!(audioDestNode && audioFile);
    const mimeType = getBestMimeType(includeAudio);
    const { isSafari } = getBrowserInfo();

    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5000000,
    });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const actualMimeType = recorder.mimeType;
      const blob = new Blob(recordedChunksRef.current, { type: actualMimeType });
      console.log(`[Recording] Stopped. Blob size: ${blob.size}, type: ${actualMimeType}`);

      if (blob.size === 0) {
        alert('Recording failed (empty file). Please try again.');
        setIsRecording(false);
        return;
      }

      const baseName = generateRecordingFilename(projectName);
      const ext = getExtensionFromMime(actualMimeType);

      try {
        await downloadBlob(blob, baseName, ext);
        if (isTauri()) {
          alert('Video saved successfully!');
        }
      } catch (err) {
        console.error('[Recording] Failed to save:', err);
        alert('Failed to save video.');
      }

      setIsRecording(false);
    };

    // Small delay to ensure stream is ready
    setTimeout(() => {
      if (isSafari || isTauri()) {
        // Capture audio element for Tauri/Safari (reuse MediaElementSource across recordings)
        const audio = audioRef.current;
        if (audio && audioFile) {
          try {
            if (!audioElementSourceRef.current) {
              const audioCtx = new AudioContext();
              const source = audioCtx.createMediaElementSource(audio);
              const dest = audioCtx.createMediaStreamDestination();
              source.connect(dest);
              source.connect(audioCtx.destination);
              audioElementSourceRef.current = { audioCtx, dest };
            }
            audioElementSourceRef.current.dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
          } catch (e) {
            console.warn('[Recording] Could not capture audio element:', e);
          }
        }
      }

      const timeslice = isSafari ? 100 : 1000;
      recorder.start(timeslice);
      console.log(`[Recording] Started with timeslice: ${timeslice}ms`);
      setIsRecording(true);
    }, 500);
  }, [projectName]);

  return { isRecording, startRecording, stopRecording };
}
