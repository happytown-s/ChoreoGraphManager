import { useState, useEffect, useRef, useCallback } from 'react';

export interface PlaybackAPI {
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  duration: number;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  handleSeek: (time: number) => void;
}

export function usePlayback(audioRef: React.RefObject<HTMLAudioElement | null>, audioFile: string | null): PlaybackAPI {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(30000);

  // Seek handler
  const handleSeek = useCallback((time: number, currentDuration?: number) => {
    const dur = currentDuration ?? duration;
    const newTime = Math.max(0, Math.min(time, dur));

    setCurrentTime(newTime);

    const audio = audioRef.current;
    if (audio && audioFile) {
      // Only pause if not currently playing (standard DAW UX keeps playback alive during seek)
      if (!isPlaying) {
        setIsPlaying(false);
        audio.pause();
      }

      if ('fastSeek' in audio) {
        (audio as any).fastSeek(newTime / 1000);
      } else {
        (audio as HTMLAudioElement).currentTime = newTime / 1000;
      }
    } else {
      if (isPlaying) setIsPlaying(false);
    }
  }, [duration, isPlaying, audioFile, audioRef]);

  // Animation loop for playback
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }

      const delta = timestamp - lastTimestamp;

      if (delta >= 16) { // ~60fps
        const audio = audioRef.current;
        if (audio && audioFile && !audio.paused && !audio.ended) {
          setCurrentTime(audio.currentTime * 1000);
        } else {
          setCurrentTime(prev => {
            const next = prev + delta;
            if (next >= duration) {
              setIsPlaying(false);
              return duration;
            }
            return next;
          });
        }

        lastTimestamp = timestamp;
      }

      if (isPlaying) {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, duration, audioFile, audioRef]);

  return {
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    duration,
    setDuration,
    handleSeek,
  };
}
