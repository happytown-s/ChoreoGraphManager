import { useState, useRef, useEffect, useCallback } from 'react';

export interface AudioEngineAPI {
  /** The audio element ref for <audio> tag */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** AudioContext for decoding & recording */
  audioContextRef: React.RefObject<AudioContext | null>;
  /** MediaStream destination for recording */
  audioDestNodeRef: React.RefObject<MediaStreamAudioDestinationNode | null>;
  /** Current audio file URL (for <audio> src) */
  audioFile: string | null;
  /** Display name of the loaded audio file */
  audioFileName: string | null;
  /** Decoded AudioBuffer for waveform */
  audioBuffer: AudioBuffer | null;
  /** Handle audio file upload — decodes to AudioBuffer */
  handleAudioUpload: (file: File) => Promise<void>;
  /** Ensure the <audio> element is connected to AudioContext for recording.
   *  Must be called once when playback starts (after user gesture) so that
   *  the shared MediaStreamDestinationNode carries live audio for recording.
   *  Safe to call multiple times — it guards against duplicate connections. */
  connectAudioElement: () => void;
}

export function useAudio(): AudioEngineAPI {
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Prevent duplicate MediaElementSource creation
  const mediaElementSourceCreatedRef = useRef(false);

  // Initialize AudioContext once
  useEffect(() => {
    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          audioDestNodeRef.current = dest;
          console.log('Audio Context Initialized');
        } else {
          console.warn('AudioContext not supported in this environment');
        }
      } catch (e) {
        console.error('Failed to initialize AudioContext:', e);
      }
    }
  }, []);

  /**
   * Connect the <audio> element to the shared AudioContext.
   * createMediaElementSource can only be called once per HTMLMediaElement.
   * After that call, audio output goes through the AudioContext graph.
   * We connect it to both ctx.destination (speakers) and the shared
   * MediaStreamDestinationNode (for recording).
   *
   * This must be triggered after a user gesture to satisfy autoplay policies.
   */
  const connectAudioElement = useCallback(() => {
    const audio = audioRef.current;
    const ctx = audioContextRef.current;
    const dest = audioDestNodeRef.current;

    if (!audio || !ctx || !dest) return;
    if (mediaElementSourceCreatedRef.current) return; // already connected

    try {
      const source = ctx.createMediaElementSource(audio);
      source.connect(ctx.destination); // speakers
      source.connect(dest);            // recording stream
      mediaElementSourceCreatedRef.current = true;
      console.log('Audio element connected to AudioContext (recording-ready)');
    } catch (e) {
      // createMediaElementSource throws if already called — ignore
      console.warn('[Audio] createMediaElementSource skipped (already connected):', e);
    }
  }, []);

  const handleAudioUpload = async (file: File) => {
    // Reset connection flag so the new audio element source gets connected
    mediaElementSourceCreatedRef.current = false;

    const url = URL.createObjectURL(file);
    setAudioFile(url);
    setAudioFileName(file.name);

    if (audioContextRef.current) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const decodedData = await audioContextRef.current.decodeAudioData(arrayBuffer);
        setAudioBuffer(decodedData);
        console.log('Audio Decoded successfully');
      } catch (e) {
        console.error('Audio decoding failed:', e);
        alert('Audio load failed. Please try another file.');
      }
    }
  };

  return {
    audioRef,
    audioContextRef,
    audioDestNodeRef,
    audioFile,
    audioFileName,
    audioBuffer,
    handleAudioUpload,
    connectAudioElement,
  };
}
