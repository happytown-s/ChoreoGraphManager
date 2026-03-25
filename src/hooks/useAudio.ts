import { useState, useRef, useEffect } from 'react';

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
}

export function useAudio(): AudioEngineAPI {
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

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

  const handleAudioUpload = async (file: File) => {
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
  };
}
