import { useState, useRef, useCallback } from 'react';
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
    audioCtxRef?: React.RefObject<AudioContext | null>,
  ) => void;
  stopRecording: () => void;
}

export function useRecording(projectName: string): RecordingAPI {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  // Track the audio element that was used to create MediaElementSource,
  // so we never call createMediaElementSource twice on the same element.
  const mediaElementSourceRef = useRef<{ element: HTMLAudioElement; source: MediaElementAudioSourceNode; ctx: AudioContext } | null>(null);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.requestData();
      } catch (err) {
        console.warn('[Recording] requestData() failed before stop:', err);
      }

      window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      }, 75);
      return;
    }

  }, []);

  const startRecording = useCallback((
    stageRef: React.RefObject<StageRef | null>,
    audioDestNode: MediaStreamAudioDestinationNode | null,
    audioRef: React.RefObject<HTMLAudioElement | null>,
    audioFile: string | null,
    audioCtxRef?: React.RefObject<AudioContext | null>,
  ) => {
    if (!stageRef.current) {
      alert('Stage not available for recording.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      alert('Recording is not supported in this browser.');
      return;
    }

    // Get canvas stream
    const canvasStream = stageRef.current.getCanvasStream();
    const tracks = [...canvasStream.getVideoTracks()];
    const audio = audioRef.current;
    let recordingAudioDestination: MediaStreamAudioDestinationNode | null = null;
    let recordingAudioSource: MediaElementAudioSourceNode | null = null;

    if (audio && audioFile) {
      try {
        const sharedCtx = audioCtxRef?.current;
        const existing = mediaElementSourceRef.current;

        if (existing && existing.element === audio) {
          recordingAudioSource = existing.source;
          recordingAudioDestination = existing.ctx.createMediaStreamDestination();
        } else {
          const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          const audioCtx = sharedCtx ?? (AudioContextClass ? new AudioContextClass() : null);
          if (!audioCtx) {
            throw new Error('AudioContext not supported');
          }

          recordingAudioSource = audioCtx.createMediaElementSource(audio);
          recordingAudioSource.connect(audioCtx.destination);
          recordingAudioDestination = audioCtx.createMediaStreamDestination();
          mediaElementSourceRef.current = { element: audio, source: recordingAudioSource, ctx: audioCtx };
        }

        if (recordingAudioDestination && recordingAudioSource) {
          recordingAudioSource.connect(recordingAudioDestination);
          tracks.push(...recordingAudioDestination.stream.getAudioTracks());
        }
      } catch (e) {
        console.warn('[Recording] Could not capture audio element:', e);
      }
    } else if (audioDestNode && audioFile) {
      const audioTracks = audioDestNode.stream.getAudioTracks();
      tracks.push(...audioTracks);
    }

    const stream = new MediaStream(tracks);
    const includeAudio = stream.getAudioTracks().length > 0;
    const mimeType = getBestMimeType(includeAudio);
    const { isSafari } = getBrowserInfo();

    recordedChunksRef.current = [];
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5000000,
      });
    } catch (err) {
      console.error('[Recording] Failed to create MediaRecorder:', err);
      if (recordingAudioSource && recordingAudioDestination) {
        recordingAudioSource.disconnect(recordingAudioDestination);
      }
      stream.getTracks().forEach(track => track.stop());
      alert('Recording could not start in this browser.');
      return;
    }

    mediaRecorderRef.current = recorder;
    let didFinalize = false;
    let finalizeTimer: number | null = null;

    const cleanupResources = () => {
      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }

      if (recordingAudioSource && recordingAudioDestination) {
        try {
          recordingAudioSource.disconnect(recordingAudioDestination);
        } catch (err) {
          console.warn('[Recording] Failed to disconnect audio tap:', err);
        }
      }

      stream.getTracks().forEach(track => track.stop());

      if (mediaRecorderRef.current === recorder) {
        mediaRecorderRef.current = null;
      }
    };

    const finalizeRecording = async () => {
      if (didFinalize) {
        return;
      }
      didFinalize = true;

      const actualMimeType = recorder.mimeType || mimeType;
      const blob = new Blob(recordedChunksRef.current, { type: actualMimeType });
      console.log(`[Recording] Stopped. Blob size: ${blob.size}, type: ${actualMimeType}`);

      cleanupResources();

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

    const scheduleFinalize = (delay: number) => {
      if (didFinalize) {
        return;
      }

      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
      }

      finalizeTimer = window.setTimeout(() => {
        void finalizeRecording();
      }, delay);
    };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }

      if (recorder.state === 'inactive') {
        scheduleFinalize(0);
      }
    };

    recorder.onerror = (event) => {
      console.error('[Recording] MediaRecorder error:', event);
      scheduleFinalize(0);
    };

    recorder.onstop = async () => {
      scheduleFinalize(250);
    };

    const startRecorder = async () => {
      const captureTracks = canvasStream.getVideoTracks() as Array<MediaStreamTrack & { requestFrame?: () => void }>;

      if (isSafari || isTauri()) {
        try {
          await mediaElementSourceRef.current?.ctx.resume();
        } catch (err) {
          console.warn('[Recording] Failed to resume audio context:', err);
        }
      }

      const timeslice = isSafari ? 100 : 1000;
      try {
        recorder.start(timeslice);
        captureTracks.forEach(track => track.requestFrame?.());
        console.log(`[Recording] Started with timeslice: ${timeslice}ms`);
        setIsRecording(true);
      } catch (err) {
        console.error('[Recording] Failed to start recorder:', err);
        cleanupResources();
        setIsRecording(false);
        alert('Recording could not start in this browser.');
      }
    };

    window.requestAnimationFrame(() => {
      void startRecorder();
    });
  }, [projectName]);

  return { isRecording, startRecording, stopRecording };
}
