import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Dancer, Keyframe, Position, Group, STAGE_WIDTH, STAGE_HEIGHT } from './types';
import Timeline from './components/Timeline';
import Stage, { StageRef } from './components/Stage';
import { GroupList } from './components/GroupList';
import { useHistory } from './hooks/useHistory';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import {
  Users, Video, Plus, Trash2, Menu, X, ChevronDown, ChevronUp,
  Grid, Play, Pause, SkipForward, SkipBack, Magnet, Search, Save, FolderOpen,
  Undo2, Redo2
} from 'lucide-react';

const INITIAL_DANCERS: Dancer[] = [
  { id: 'd1', name: 'Alice', color: '#ef4444' },
  { id: 'd2', name: 'Bob', color: '#3b82f6' },
  { id: 'd3', name: 'Charlie', color: '#10b981' },
  { id: 'd4', name: 'Diana', color: '#f59e0b' },
  { id: 'd5', name: 'Evan', color: '#8b5cf6' },
];

const INITIAL_POSITIONS: Record<string, Position> = {
  d1: { x: 200, y: 300 },
  d2: { x: 300, y: 300 },
  d3: { x: 400, y: 300 },
  d4: { x: 500, y: 300 },
  d5: { x: 600, y: 300 },
};

const isTauri = () => '__TAURI_INTERNALS__' in window;

function App() {
  // --- State ---
  const [dancers, setDancers] = useState<Dancer[]>(INITIAL_DANCERS);
  const [selectedDancerIds, setSelectedDancerIds] = useState<Set<string>>(new Set());
  const [keyframes, setKeyframes] = useState<Keyframe[]>([
    { id: 'start', timestamp: 0, positions: INITIAL_POSITIONS }
  ]);
  const [groups, setGroups] = useState<Group[]>([]);

  // History Management
  const {
    state: historyState,
    pushState,
    undo,
    redo,
    canUndo,
    canRedo,
    set: setHistory
  } = useHistory({ dancers: INITIAL_DANCERS, keyframes: [{ id: 'start', timestamp: 0, positions: INITIAL_POSITIONS }], groups: [] as Group[] });

  // Sync state from history
  useEffect(() => {
    setDancers(historyState.dancers);
    setKeyframes(historyState.keyframes);
    setGroups(historyState.groups);
  }, [historyState]);

  // Helper to push new state
  const pushHistory = (newDancers: Dancer[], newKeyframes: Keyframe[], newGroups: Group[]) => {
    pushState({ dancers: newDancers, keyframes: newKeyframes, groups: newGroups });
  };

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(30000);

  const [projectName, setProjectName] = useState("Untitled Project");

  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);

  // 【追加】録画用にデコードした音声データを保持する
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Audio Graph Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(true);
  const [gridSize, setGridSize] = useState(50);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isMultiSelectionEnabled, setIsMultiSelectionEnabled] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const stageRef = useRef<StageRef>(null);

  // --- Audio Graph Setup (初期化) ---
  useEffect(() => {
    // AudioContextと録音用ノードだけ作っておく
    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;

          // 録音用の出力先（Destination）を作成
          const dest = ctx.createMediaStreamDestination();
          audioDestNodeRef.current = dest;
          console.log("Audio Context Initialized");
        } else {
          console.warn("AudioContext not supported in this environment");
        }
      } catch (e) {
        console.error("Failed to initialize AudioContext:", e);
      }
    }
  }, []);

  // Prevent Browser Zoom (Global)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
      }

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canUndo, canRedo, undo, redo]);

  // Sync Audio Play/Pause (Preview用)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioFile) return;

    if (isPlaying) {
      if (Math.abs(audio.currentTime * 1000 - currentTime) > 100) {
        audio.currentTime = currentTime / 1000;
      }
      // ContextがSuspendedならResumeする
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audio.play().catch(e => console.error("Audio play failed:", e));
    } else {
      audio.pause();
    }
  }, [isPlaying, audioFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize sorted keyframes to avoid sorting on every frame
  const sortedKeyframes = useMemo(() => {
    return [...keyframes].sort((a, b) => a.timestamp - b.timestamp);
  }, [keyframes]);

  // Interpolation Logic
  const getCurrentPositions = useCallback((): Record<string, Position> => {
    const sorted = sortedKeyframes;
    let prevKf = sorted[0];
    let nextKf = sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].timestamp <= currentTime) {
        prevKf = sorted[i];
      }
      if (sorted[i].timestamp >= currentTime) {
        nextKf = sorted[i];
        break;
      }
    }

    if (prevKf.id === nextKf.id) return prevKf.positions;

    const totalDuration = nextKf.timestamp - prevKf.timestamp;
    const elapsed = currentTime - prevKf.timestamp;
    const progress = Math.min(1, Math.max(0, elapsed / totalDuration));

    const interpolated: Record<string, Position> = {};
    dancers.forEach(dancer => {
      const startPos = prevKf.positions[dancer.id] || { x: 0, y: 0 };
      const endPos = nextKf.positions[dancer.id] || startPos;

      const controlPoint = prevKf.controlPoints?.[dancer.id];
      if (controlPoint) {
        // Quadratic Bezier: (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
        const t = progress;
        const invT = 1 - t;
        interpolated[dancer.id] = {
          x: invT * invT * startPos.x + 2 * invT * t * controlPoint.x + t * t * endPos.x,
          y: invT * invT * startPos.y + 2 * invT * t * controlPoint.y + t * t * endPos.y
        };
      } else {
        // Linear
        interpolated[dancer.id] = {
          x: startPos.x + (endPos.x - startPos.x) * progress,
          y: startPos.y + (endPos.y - startPos.y) * progress,
        };
      }
    });
    return interpolated;
  }, [currentTime, sortedKeyframes, dancers]);

  const currentPositions = getCurrentPositions();

  // Active Paths for Visualization
  const activePaths = useMemo(() => {
    if (selectedDancerIds.size === 0) return [];

    const sorted = sortedKeyframes;
    let prevKf = sorted[0];
    let nextKf = sorted[sorted.length - 1];

    // Find the segment covering current time
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].timestamp <= currentTime) {
        prevKf = sorted[i];
      }
      if (sorted[i].timestamp > currentTime) {
        nextKf = sorted[i];
        break;
      }
    }

    if (prevKf.id === nextKf.id) return [];

    const paths: any[] = [];
    selectedDancerIds.forEach(id => {
      const startPos = prevKf.positions[id];
      const endPos = nextKf.positions[id];
      if (startPos && endPos) {
        let cp = prevKf.controlPoints?.[id];
        if (!cp) {
          // Default to midpoint if not derived yet
          cp = { x: (startPos.x + endPos.x) / 2, y: (startPos.y + endPos.y) / 2 };
        }
        paths.push({
          keyframeId: prevKf.id,
          dancerId: id,
          startPos,
          endPos,
          controlPoint: cp
        });
      }
    });
    return paths;
  }, [selectedDancerIds, sortedKeyframes, currentTime]);

  const handleControlPointChange = (keyframeId: string, dancerId: string, newCP: Position) => {
    setIsPlaying(false);
    const newKeyframes = keyframes.map(kf => {
      if (kf.id === keyframeId) {
        return {
          ...kf,
          controlPoints: {
            ...(kf.controlPoints || {}),
            [dancerId]: newCP
          }
        };
      }
      return kf;
    });
    pushHistory(dancers, newKeyframes, groups);
  };

  // Playback Loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp = 0;

    const tick = (timestamp: number) => {
      if (!lastTimestamp) lastTimestamp = timestamp;

      // 録画中はパフォーマンスを優先し、またAudioタグの再生状況に依存させないためDeltaTimeを使う
      if (isRecording && isPlaying) {
        const delta = timestamp - lastTimestamp;
        setCurrentTime(prev => {
          const next = prev + delta;
          if (next >= duration) {
            setIsPlaying(false);
            if (isRecording) stopRecording();
            return duration;
          }
          return next;
        });
      }
      // プレビュー中はAudioタグの時間を使う
      else if (audioFile && audioRef.current && isPlaying && !audioRef.current.paused) {
        const audioTime = audioRef.current.currentTime * 1000;
        setCurrentTime(prev => {
          if (audioTime >= duration) {
            setIsPlaying(false);
            if (isRecording) stopRecording();
            return duration;
          }
          return audioTime;
        });
      } else if (isPlaying) {
        const delta = timestamp - lastTimestamp;
        setCurrentTime(prev => {
          const next = prev + delta;
          if (next >= duration) {
            setIsPlaying(false);
            if (isRecording) stopRecording();
            return duration;
          }
          return next;
        });
      }

      lastTimestamp = timestamp;
      if (isPlaying) {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, duration, isRecording, audioFile]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setIsSidebarOpen(false);
      else setIsSidebarOpen(true);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 【修正】アップロード時にAudioBufferとしてデコードする
  const handleAudioUpload = async (file: File) => {
    const url = URL.createObjectURL(file);
    setAudioFile(url);
    setAudioFileName(file.name);

    if (audioContextRef.current) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const decodedData = await audioContextRef.current.decodeAudioData(arrayBuffer);
        setAudioBuffer(decodedData);
        console.log("Audio Decoded successfully");
      } catch (e) {
        console.error("Audio decoding failed:", e);
        alert("Audio load failed. Please try another file.");
      }
    }
  };

  const handleSeek = useCallback((time: number) => {
    const newTime = Math.max(0, Math.min(time, duration));

    // UIを即座に更新
    setCurrentTime(newTime);

    const audio = audioRef.current;
    if (audio && audioFile) {
      // 再生中なら一時停止して、ループや競合を防ぐ
      if (isPlaying) {
        setIsPlaying(false);
        audio.pause();
      }

      // fastSeekが使える場合は使う（よりスムーズなシーク）
      if ('fastSeek' in audio) {
        (audio as any).fastSeek(newTime / 1000);
      } else {
        (audio as HTMLAudioElement).currentTime = newTime / 1000;
      }
    } else {
      if (isPlaying) setIsPlaying(false);
    }
  }, [duration, isPlaying, audioFile]);

  const handlePositionChange = (dancerId: string, newPos: Position) => {
    setIsPlaying(false);

    // Check if we are close to an existing keyframe
    const existingIndex = keyframes.findIndex(k => Math.abs(k.timestamp - currentTime) < 50);
    let newKeyframes;

    if (existingIndex >= 0) {
      newKeyframes = [...keyframes];
      newKeyframes[existingIndex] = {
        ...newKeyframes[existingIndex],
        positions: { ...newKeyframes[existingIndex].positions, [dancerId]: newPos }
      };
    } else {
      const newKf: Keyframe = {
        id: Date.now().toString(),
        timestamp: currentTime,
        positions: { ...currentPositions, [dancerId]: newPos }
      };
      newKeyframes = [...keyframes, newKf].sort((a, b) => a.timestamp - b.timestamp);
    }
    pushHistory(dancers, newKeyframes, groups);
  };

  // Multi-dancer position change (for group drag)
  // Multi-dancer position change (for group drag)
  const handleMultiPositionChange = (changes: Record<string, Position>) => {
    setIsPlaying(false);

    const existingIndex = keyframes.findIndex(k => Math.abs(k.timestamp - currentTime) < 50);
    let newKeyframes;

    if (existingIndex >= 0) {
      newKeyframes = [...keyframes];
      newKeyframes[existingIndex] = {
        ...newKeyframes[existingIndex],
        positions: { ...newKeyframes[existingIndex].positions, ...changes }
      };
    } else {
      const newKf: Keyframe = {
        id: Date.now().toString(),
        timestamp: currentTime,
        positions: { ...currentPositions, ...changes }
      };
      newKeyframes = [...keyframes, newKf].sort((a, b) => a.timestamp - b.timestamp);
    }
    pushHistory(dancers, newKeyframes, groups);
  };

  const handleAddKeyframe = () => {
    if (keyframes.some(k => Math.abs(k.timestamp - currentTime) < 50)) return;
    const newKf: Keyframe = {
      id: Date.now().toString(),
      timestamp: currentTime,
      positions: { ...currentPositions }
    };
    const newKeyframes = [...keyframes, newKf].sort((a, b) => a.timestamp - b.timestamp);
    pushHistory(dancers, newKeyframes, groups);
  };

  const handleDeleteKeyframe = (id: string) => {
    const kf = keyframes.find(k => k.id === id);
    if (kf && kf.timestamp === 0) return;
    const newKeyframes = keyframes.filter(k => k.id !== id);
    pushHistory(dancers, newKeyframes, groups);
  };

  const handleUpdateKeyframeTime = (id: string, newTime: number) => {
    if (newTime < 0) newTime = 0;
    const kf = keyframes.find(k => k.id === id);
    if (kf && kf.timestamp === 0 && newTime !== 0) return;

    const newKeyframes = keyframes.map(k => k.id === id ? { ...k, timestamp: newTime } : k)
      .sort((a, b) => a.timestamp - b.timestamp);

    pushHistory(dancers, newKeyframes, groups);
    setCurrentTime(newTime);
  };

  const handleJumpNextKeyframe = () => {
    const sorted = sortedKeyframes;
    const next = sorted.find(k => k.timestamp > currentTime + 50);
    handleSeek(next ? next.timestamp : 0);
  };

  const handleJumpPrevKeyframe = () => {
    const sorted = sortedKeyframes;
    const prevs = sorted.filter(k => k.timestamp < currentTime - 50);
    handleSeek(prevs.length ? prevs[prevs.length - 1].timestamp : 0);
  };

  // --- Browser Detection ---
  const getBrowserInfo = () => {
    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChrome = /chrome|chromium|crios/i.test(ua);
    const isFirefox = /firefox/i.test(ua);
    const isTauriEnv = isTauri();
    return { isSafari, isChrome, isFirefox, isTauriEnv };
  };

  // --- Get Best MIME Type for Browser ---
  const getBestMimeType = (includeAudio: boolean): string => {
    const { isSafari, isChrome, isTauriEnv } = getBrowserInfo();

    // Safari & Tauri (WKWebView) - prefer MP4 H.264
    if (isSafari || isTauriEnv) {
      const safariTypes = [
        'video/mp4;codecs="avc1,mp4a.40.2"',
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ];
      for (const type of safariTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          console.log(`[Safari/Tauri] Using MIME: ${type}`);
          return type;
        }
      }
    }

    // Chrome - prefer WebM VP9, fallback to VP8 or MP4
    if (isChrome) {
      const chromeTypes = includeAudio ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4'
      ] : [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4'
      ];
      for (const type of chromeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          console.log(`[Chrome] Using MIME: ${type}`);
          return type;
        }
      }
    }

    // Fallback - try common types
    const fallbackTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];
    for (const type of fallbackTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`[Fallback] Using MIME: ${type}`);
        return type;
      }
    }

    console.warn('[Recording] No specific MIME type supported, using default');
    return '';
  };

  // --- Get File Extension from MIME ---
  const getExtensionFromMime = (mimeType: string): string => {
    if (mimeType.includes('mp4') || mimeType.includes('avc1')) return 'mp4';
    if (mimeType.includes('webm')) return 'webm';
    return 'webm';
  };

  // --- Cross-Browser Video Recording ---
  const startRecording = async () => {
    if (!stageRef.current) {
      alert('Stage not ready. Please try again.');
      return;
    }

    // Check MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
      alert('Recording is not supported in this browser. Please use Chrome, Safari 14.3+, or Firefox.');
      return;
    }

    const { isSafari } = getBrowserInfo();
    console.log(`[Recording] Starting... Browser detected: Safari=${isSafari}`);

    setCurrentTime(0);

    // Mute preview audio
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.muted = true;
      audioRef.current.pause();
    }

    setTimeout(async () => {
      setIsPlaying(true);
      setIsRecording(true);
      if (audioRef.current) audioRef.current.play();

      const canvasStream = stageRef.current!.getCanvasStream();
      let finalStream: MediaStream = canvasStream;
      let bufferSource: AudioBufferSourceNode | null = null;
      let hasAudio = false;

      // Audio mixing
      if (audioBuffer && audioContextRef.current && audioDestNodeRef.current) {
        try {
          await audioContextRef.current.resume();
          bufferSource = audioContextRef.current.createBufferSource();
          bufferSource.buffer = audioBuffer;
          bufferSource.connect(audioDestNodeRef.current);
          bufferSource.connect(audioContextRef.current.destination);
          bufferSource.start(0);

          const audioTracks = audioDestNodeRef.current.stream.getAudioTracks();
          if (audioTracks.length > 0) {
            console.log('[Recording] Audio tracks mixed successfully');
            // Create new stream with both video and audio
            finalStream = new MediaStream([
              ...canvasStream.getVideoTracks(),
              ...audioDestNodeRef.current.stream.getAudioTracks()
            ]);
            hasAudio = true;
          }
        } catch (e) {
          console.warn('[Recording] Audio mixing failed:', e);
        }
      }

      // Get best MIME type for current browser
      const mimeType = getBestMimeType(hasAudio);

      // Determine video bitrate based on browser
      const { isSafari: isSaf } = getBrowserInfo();
      const videoBitsPerSecond = isSaf ? 4000000 : 2500000; // Safari prefers higher bitrate

      const options: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond
      };

      let mediaRecorder: MediaRecorder;

      try {
        // Try with full options first
        mediaRecorder = new MediaRecorder(finalStream, options);
        console.log(`[Recording] MediaRecorder created with MIME: ${mimeType}`);
      } catch (e) {
        console.warn('[Recording] Failed with options, trying without mimeType:', e);
        try {
          // Fallback without specific MIME type
          mediaRecorder = new MediaRecorder(finalStream, { videoBitsPerSecond });
        } catch (e2) {
          console.error('[Recording] MediaRecorder creation failed completely:', e2);
          alert('Recording failed to start. Please try a different browser.');
          setIsRecording(false);
          setIsPlaying(false);
          return;
        }
      }

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Recording] MediaRecorder error:', event);
        alert('Recording error occurred. Please try again.');
        setIsRecording(false);
        setIsPlaying(false);
      };

      mediaRecorder.onstop = async () => {
        // Cleanup audio
        if (bufferSource) {
          try { bufferSource.stop(); } catch { }
          try { bufferSource.disconnect(); } catch { }
        }
        if (audioRef.current) {
          audioRef.current.muted = false;
        }

        // Determine actual MIME type used
        const actualMimeType = mediaRecorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type: actualMimeType });

        console.log(`[Recording] Stopped. Blob size: ${blob.size}, type: ${actualMimeType}`);

        if (blob.size === 0) {
          alert('Recording failed (empty file). Please try again.');
          setIsRecording(false);
          return;
        }

        // Generate filename
        const now = new Date();
        const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const safeProjectName = projectName.replace(/[^a-z0-9_\-\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
        const ext = getExtensionFromMime(actualMimeType);
        const filename = `${safeProjectName}-${formattedDate}.${ext}`;

        if (isTauri()) {
          try {
            const filePath = await save({
              defaultPath: filename,
              filters: [{ name: 'Video', extensions: [ext] }]
            });

            if (filePath) {
              const arrayBuffer = await blob.arrayBuffer();
              await writeFile(filePath, new Uint8Array(arrayBuffer));
              alert('Video saved successfully!');
            }
          } catch (err) {
            console.error('[Recording] Failed to save in Tauri:', err);
            alert('Failed to save video.');
          }
        } else {
          // Web download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();

          // Cleanup after download starts
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 1000);
        }
        setIsRecording(false);
      };

      // Start recording with timeslice for better compatibility
      // Safari works better with 100ms, Chrome with 1000ms
      const timeslice = isSafari ? 100 : 1000;
      mediaRecorder.start(timeslice);
      console.log(`[Recording] Started with timeslice: ${timeslice}ms`);

    }, 500);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // --- Project Save/Load ---
  const saveProject = async () => {
    try {
      const projectData = {
        version: 1,
        projectName,
        dancers,
        keyframes,
        duration,
        audioFileName
      };

      if (isTauri()) {
        const filePath = await save({
          defaultPath: `${projectName}.json`,
          filters: [{
            name: 'ChoreoGraph Project',
            extensions: ['json']
          }]
        });

        if (filePath) {
          await writeTextFile(filePath, JSON.stringify(projectData, null, 2));
          alert("Project saved successfully!");
        }
      } else {
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
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
      console.error("Failed to save project:", e);
      alert("Failed to save project.");
    }
  };

  const loadProject = async () => {
    try {
      if (isTauri()) {
        const filePath = await open({
          filters: [{
            name: 'ChoreoGraph Project',
            extensions: ['json']
          }]
        });

        if (filePath && typeof filePath === 'string') {
          const content = await readTextFile(filePath);
          const data = JSON.parse(content);

          if (data.version === 1) {
            setProjectName(data.projectName || "Untitled Project");
            setDancers(data.dancers || []);
            setKeyframes(data.keyframes || []);
            setDuration(data.duration || 30000);
            setAudioFileName(data.audioFileName || null);
            // Reset audio file content as we can't load it from path easily/securely without user action usually
            // But we keep the name so user knows what to load
            setAudioFile(null);
            setAudioBuffer(null);
            alert(`Project loaded! Please re-upload audio: ${data.audioFileName || "None"}`);
          } else {
            alert("Unknown project version.");
          }
        }
      } else {
        // Web fallback (input file)
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            const text = await file.text();
            const data = JSON.parse(text);
            if (data.version === 1) {
              setProjectName(data.projectName || "Untitled Project");
              setDancers(data.dancers || []);
              setKeyframes(data.keyframes || []);
              setDuration(data.duration || 30000);
              setAudioFileName(data.audioFileName || null);
              setAudioFile(null);
              setAudioBuffer(null);
              alert(`Project loaded! Please re-upload audio: ${data.audioFileName || "None"}`);
            }
          }
        };
        input.click();
      }
    } catch (e) {
      console.error("Failed to load project:", e);
      alert("Failed to load project.");
    }
  };

  const addNewDancer = () => {
    const newId = `d${Date.now()}`;
    const newDancer: Dancer = {
      id: newId,
      name: `Dancer ${dancers.length + 1}`,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16)
    };

    const newDancers = [...dancers, newDancer];
    // Add initial position for the new dancer to all keyframes
    const newKeyframes = keyframes.map(kf => ({
      ...kf,
      positions: { ...kf.positions, [newId]: { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 } }
    }));

    pushHistory(newDancers, newKeyframes, groups);
  };

  const removeDancer = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const newDancers = dancers.filter(d => d.id !== id);
    const newKeyframes = keyframes.map(kf => {
      const { [id]: _, ...rest } = kf.positions;
      return { ...kf, positions: rest };
    });

    pushHistory(newDancers, newKeyframes, groups);

    setSelectedDancerIds(prev => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return prev;
    });
  };

  const updateDancer = (id: string, updates: Partial<Dancer>) => {
    const newDancers = dancers.map(d => d.id === id ? { ...d, ...updates } : d);
    pushHistory(newDancers, keyframes, groups);
  };

  // --- Group Handlers ---
  const handleAddGroup = () => {
    const newGroup: Group = {
      id: `g${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      isVisible: true,
      isSolo: false
    };
    pushHistory(dancers, keyframes, [...groups, newGroup]);
  };

  const handleUpdateGroup = (updatedGroup: Group) => {
    const newGroups = groups.map(g => g.id === updatedGroup.id ? updatedGroup : g);
    pushHistory(dancers, keyframes, newGroups);
  };

  const handleDeleteGroup = (groupId: string) => {
    const newGroups = groups.filter(g => g.id !== groupId);
    const newDancers = dancers.map(d => d.groupId === groupId ? { ...d, groupId: undefined } : d);
    pushHistory(newDancers, keyframes, newGroups);
  };

  const handleAssignDancerToGroup = (dancerId: string, groupId: string | undefined) => {
    const newDancers = dancers.map(d => d.id === dancerId ? { ...d, groupId } : d);
    pushHistory(newDancers, keyframes, groups);
  };

  const handleToggleSolo = (groupId: string) => {
    const targetGroup = groups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const isCurrentlySolo = targetGroup.isSolo;
    const newGroups = groups.map(g => ({
      ...g,
      isSolo: g.id === groupId ? !isCurrentlySolo : false
    }));
    pushHistory(dancers, keyframes, newGroups);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-950 text-white font-sans overflow-hidden touch-none">
      {/* Hidden Audio Element with crossOrigin */}
      <audio
        ref={audioRef}
        src={audioFile || undefined}
        crossOrigin="anonymous"
        className="hidden"
        preload="auto"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration * 1000;
          if (d && !isNaN(d) && d > 0) {
            setDuration(Math.ceil(d));
          }
        }}
        onError={(e) => console.error("Audio Load Error", e)}
      />

      <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0 z-30 relative">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center hidden sm:flex">
              <Users className="text-white" size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight hidden sm:block">ChoreoGraphManager</h1>
            </div>
          </div>
        </div>

        {/* Project Name Input */}
        <div className="flex-1 mx-4 max-w-md">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-1.5 rounded border border-gray-700 focus:border-indigo-500 focus:outline-none text-center font-medium"
            placeholder="Project Name"
          />
        </div>

        <div className="flex items-center space-x-2 sm:space-x-4">
          {/* Project Controls */}
          <div className="flex items-center space-x-1 mr-2 border-r border-gray-700 pr-3">
            <button
              onClick={loadProject}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition"
              title="Load Project"
            >
              <FolderOpen size={18} />
            </button>
            <button
              onClick={saveProject}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition"
              title="Save Project"
            >
              <Save size={18} />
            </button>
          </div>

          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isPlaying && !isRecording}
            className={`flex items-center justify-center p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-semibold transition ${isRecording
              ? 'bg-red-600 hover:bg-red-700 animate-pulse text-white'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'
              }`}
            title="Export Video"
          >
            {isRecording ? (
              <span className="w-4 h-4 rounded-sm bg-white" />
            ) : (
              <Video size={18} />
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        <div className={`absolute top-0 bottom-0 left-0 bg-gray-900 border-r border-gray-800 z-30 transition-all duration-300 ease-in-out flex flex-col shadow-2xl pointer-events-auto ${isSidebarOpen ? 'w-full sm:w-80 translate-x-0 max-w-[360px]' : 'w-80 -translate-x-full'}`}>

          {/* Group List */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-slate-900">
            <GroupList
              groups={groups}
              dancers={dancers}
              onAddGroup={handleAddGroup}
              onUpdateGroup={handleUpdateGroup}
              onDeleteGroup={handleDeleteGroup}
              onAssignDancerToGroup={handleAssignDancerToGroup}
              onToggleSolo={handleToggleSolo}
              onAddDancer={addNewDancer}
              onDeleteDancer={removeDancer}
            />
          </div>
        </div>

        <main className={`flex-1 bg-gray-950 flex flex-col relative overflow-hidden transition-all duration-300 min-h-0 ${isSidebarOpen ? 'sm:ml-72' : 'ml-0'}`}>
          {isSidebarOpen && <div className="absolute inset-0 bg-black/50 z-10 sm:hidden" onClick={() => setIsSidebarOpen(false)} />}
          <div className="relative w-full h-full flex flex-col">
            <div className="h-10 border-b border-gray-800 bg-gray-900 flex items-center justify-end px-4 z-20 shrink-0">
              <div className="flex items-center space-x-3 group">
                <div className="flex items-center gap-2 mr-2 border-r border-gray-700 pr-3">
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    className={`flex items-center justify-center w-10 h-10 sm:w-auto sm:h-auto sm:gap-1 sm:px-3 sm:py-1.5 rounded-lg text-sm font-medium transition ${canUndo ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white active:bg-gray-600' : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'}`}
                    title="Undo (Cmd+Z)"
                  >
                    <Undo2 size={22} className="sm:hidden" strokeWidth={2.5} />
                    <Undo2 size={16} className="hidden sm:block" />
                    <span className="hidden sm:inline">Undo</span>
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    className={`flex items-center justify-center w-10 h-10 sm:w-auto sm:h-auto sm:gap-1 sm:px-3 sm:py-1.5 rounded-lg text-sm font-medium transition ${canRedo ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white active:bg-gray-600' : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'}`}
                    title="Redo (Cmd+Shift+Z)"
                  >
                    <Redo2 size={22} className="sm:hidden" strokeWidth={2.5} />
                    <Redo2 size={16} className="hidden sm:block" />
                    <span className="hidden sm:inline">Redo</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2 bg-gray-800 rounded px-2 py-1 mr-2">
                  <Search size={14} className="text-gray-400" />
                  <input type="range" min="0.1" max="3" step="0.1" value={zoomLevel} onChange={(e) => setZoomLevel(parseFloat(e.target.value))} className="w-20 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                </div>

                <button
                  onClick={() => setIsMultiSelectionEnabled(!isMultiSelectionEnabled)}
                  className={`p-1.5 rounded transition flex items-center justify-center ${isMultiSelectionEnabled ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                  title="Multi-Select Mode"
                >
                  <Users size={18} />
                </button>

                <button onClick={() => setIsSnapEnabled(!isSnapEnabled)} className={`p-1.5 rounded transition flex items-center justify-center ${isSnapEnabled ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}><Magnet size={18} /></button>
                <div className="w-px h-4 bg-gray-700 mx-2" />
                <div className="flex items-center space-x-2"><Grid size={16} className="text-gray-400" /><select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))} className="bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 px-2 py-1 focus:outline-none focus:border-indigo-500">{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(size => (<option key={size} value={size}>{size === 0 ? "Off" : `${size}px`}</option>))}</select></div>
              </div>
            </div>
            <div className="relative flex-1 w-full overflow-hidden bg-gray-950">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-full">
                  <Stage
                    ref={stageRef}
                    dancers={dancers}
                    positions={currentPositions}
                    onPositionChange={handlePositionChange}
                    onMultiPositionChange={handleMultiPositionChange}
                    isRecording={isRecording}
                    selectedDancerIds={selectedDancerIds}
                    onSelectDancers={setSelectedDancerIds}
                    gridSize={gridSize}
                    snapToGrid={isSnapEnabled}
                    zoom={zoomLevel}
                    onZoomChange={setZoomLevel}
                    activePaths={activePaths}
                    onControlPointChange={handleControlPointChange}
                    groups={groups}
                    isMultiSelectEnabled={isMultiSelectionEnabled}
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <div className={`shrink-0 z-30 transition-all duration-300 bg-gray-900 border-t border-gray-800 flex flex-col ${isTimelineExpanded ? 'h-48' : 'h-12'}`}>
        <div className="h-0 flex justify-center -translate-y-3">
          <button onClick={() => setIsTimelineExpanded(!isTimelineExpanded)} className="bg-gray-800 border border-gray-700 rounded-full p-1 hover:bg-gray-700 text-gray-400 shadow-md z-40">
            {isTimelineExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
        <div className={isTimelineExpanded ? 'h-full' : 'hidden'}>
          <Timeline duration={duration} setDuration={setDuration} currentTime={currentTime} isPlaying={isPlaying} keyframes={keyframes} onSeek={handleSeek} onTogglePlay={() => setIsPlaying(!isPlaying)} onAddKeyframe={handleAddKeyframe} onDeleteKeyframe={handleDeleteKeyframe} onUpdateKeyframeTime={handleUpdateKeyframeTime} onJumpPrev={handleJumpPrevKeyframe} onJumpNext={handleJumpNextKeyframe} onAudioUpload={handleAudioUpload} audioFileName={audioFileName} audioBuffer={audioBuffer} />
        </div>
        {!isTimelineExpanded && (
          <div className="flex items-center justify-between px-4 h-full">
            <div className="flex items-center space-x-2">
              <button onClick={() => handleSeek(0)} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipBack size={16} /></button>
              <button onClick={handleJumpPrevKeyframe} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipBack size={16} className="rotate-180 transform -scale-x-100" /></button>
              <button onClick={() => setIsPlaying(!isPlaying)} className="p-1.5 rounded-full bg-gray-800 text-white hover:bg-gray-700 transition">{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
              <button onClick={handleJumpNextKeyframe} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipForward size={16} /></button>
            </div>
            <div className="flex items-center space-x-2"><span className="text-xs font-mono text-gray-400">{(currentTime / 1000).toFixed(2)}s / {(duration / 1000).toFixed(0)}s</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;