import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Dancer, Keyframe, Position, STAGE_WIDTH, STAGE_HEIGHT } from './types';
import Timeline from './components/Timeline';
import Stage, { StageRef } from './components/Stage';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { 
  Users, Video, Plus, Trash2, Menu, X, ChevronDown, ChevronUp,
  Grid, Play, Pause, SkipForward, SkipBack, Magnet, Search, Save, FolderOpen
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
  const [selectedDancerId, setSelectedDancerId] = useState<string | null>(null);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([
    { id: 'start', timestamp: 0, positions: INITIAL_POSITIONS }
  ]);
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
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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
      interpolated[dancer.id] = {
        x: startPos.x + (endPos.x - startPos.x) * progress,
        y: startPos.y + (endPos.y - startPos.y) * progress,
      };
    });
    return interpolated;
  }, [currentTime, sortedKeyframes, dancers]);

  const currentPositions = getCurrentPositions();

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
             audio.currentTime = newTime / 1000;
        }
    } else {
        if (isPlaying) setIsPlaying(false);
    }
  }, [duration, isPlaying, audioFile]);

  const handlePositionChange = (dancerId: string, newPos: Position) => {
    setIsPlaying(false);
    setSelectedDancerId(dancerId);
    setKeyframes(prev => {
      const existingIndex = prev.findIndex(k => Math.abs(k.timestamp - currentTime) < 50);
      if (existingIndex >= 0) {
        const newKeyframes = [...prev];
        newKeyframes[existingIndex] = {
          ...newKeyframes[existingIndex],
          positions: { ...newKeyframes[existingIndex].positions, [dancerId]: newPos }
        };
        return newKeyframes;
      } else {
        const newKf: Keyframe = {
          id: Date.now().toString(),
          timestamp: currentTime,
          positions: { ...currentPositions, [dancerId]: newPos }
        };
        return [...prev, newKf].sort((a, b) => a.timestamp - b.timestamp);
      }
    });
  };

  const handleAddKeyframe = () => {
    setKeyframes(prev => {
      if (prev.some(k => Math.abs(k.timestamp - currentTime) < 50)) return prev;
      const newKf: Keyframe = {
        id: Date.now().toString(),
        timestamp: currentTime,
        positions: { ...currentPositions }
      };
      return [...prev, newKf].sort((a, b) => a.timestamp - b.timestamp);
    });
  };

  const handleDeleteKeyframe = (id: string) => {
    const kf = keyframes.find(k => k.id === id);
    if (kf && kf.timestamp === 0) return;
    setKeyframes(prev => prev.filter(k => k.id !== id));
  };
  
  const handleUpdateKeyframeTime = (id: string, newTime: number) => {
      if (newTime < 0) newTime = 0;
      const kf = keyframes.find(k => k.id === id);
      if (kf && kf.timestamp === 0 && newTime !== 0) return;
      setKeyframes(prev => prev.map(k => k.id === id ? { ...k, timestamp: newTime } : k)
          .sort((a, b) => a.timestamp - b.timestamp));
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

  // --- 【最強版】Video Recording ---
  const startRecording = async () => {
    if (!stageRef.current) return;
    
    // stageRef.current.resetView(); // 録画用キャンバスを使用するため、メインビューのリセットは不要
    setCurrentTime(0);
    
    // 録画中はプレビュー用の音声を止める（二重再生防止）
    // ただし、時間は進める必要があるのでミュートにする
    if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.muted = true; 
        audioRef.current.pause(); 
    }
    
    setTimeout(async () => {
        setIsPlaying(true);
        setIsRecording(true);
        if (audioRef.current) audioRef.current.play(); // 映像のコマ送りのために再生

        const canvasStream = stageRef.current!.getCanvasStream();
        let finalStream = canvasStream;
        
        // 録音用ソースノード（使い捨て）
        let bufferSource: AudioBufferSourceNode | null = null;

        // 音声がある場合、AudioBufferを使って「きれいな音」を流し込む
        if (audioBuffer && audioContextRef.current && audioDestNodeRef.current) {
             try {
                await audioContextRef.current.resume();
                
                // バッファソースを作成（再生するたびに新しく作る必要がある）
                bufferSource = audioContextRef.current.createBufferSource();
                bufferSource.buffer = audioBuffer;
                
                // 録音用ストリームに接続
                bufferSource.connect(audioDestNodeRef.current);
                
                // ユーザーにも聞こえるようにスピーカーにも接続（プレビュー用はミュートしたため）
                bufferSource.connect(audioContextRef.current.destination);
                
                bufferSource.start(0); // 0秒から再生開始

                const audioTracks = audioDestNodeRef.current.stream.getAudioTracks();
                if (audioTracks.length > 0) {
                     console.log("Audio tracks mixed successfully");
                     canvasStream.addTrack(audioTracks[0]);
                     finalStream = canvasStream;
                     
                }
             } catch (e) {
                 console.warn("AudioBuffer mixing failed:", e);
             }
        }

        // MIMEタイプの優先順位を変更（MP4を優先）
        // H.264 Baseline Profile (Safari friendly, safest for most environments)
        const mimeTypes = [
            "video/mp4;codecs=avc1.42E01E", // H.264 Baseline Profile
            "video/mp4;codecs=avc1.4d002a", // H.264 Main Profile
            'video/mp4; codecs="avc1.424028, mp4a.40.2"', // Constrained Baseline + AAC (Safe fallback)
            "video/mp4;codecs=h264",        // Generic H.264
            "video/mp4",                    // Generic MP4
            "video/webm;codecs=vp9",        // WebM fallback
            "video/webm"
        ];

        // Tauri (WKWebView) 特定のフォールバック: Generic MP4を優先してみる
        // Baseline Profileでもダメな場合、システムデフォルトに任せる
        // if (isTauri()) {
             // 既存のリストの先頭に、より緩い定義を追加
             // mimeTypes.unshift("video/mp4");
        // }
        const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "";
        console.log(`Recording with mimeType: ${mimeType}`);

        const options: MediaRecorderOptions = {
            mimeType,
            videoBitsPerSecond: 2500000
        };

        let mediaRecorder: MediaRecorder;
        try {
            mediaRecorder = new MediaRecorder(finalStream, options);
        } catch (e) {
            console.error("MediaRecorder init failed", e);
            mediaRecorder = new MediaRecorder(canvasStream, options);
        }

        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // クリーンアップ
            if (bufferSource) {
                try { bufferSource.stop(); } catch {}
                bufferSource.disconnect();
            }
            // プレビュー用オーディオのミュート解除
            if (audioRef.current) {
                audioRef.current.muted = false;
            }

            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            
            if (blob.size === 0) {
                alert("Recording failed (size is 0). Please try again.");
                setIsRecording(false);
                return;
            }

            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const H = String(now.getHours()).padStart(2, '0');
            const M = String(now.getMinutes()).padStart(2, '0');
            const formattedDate = `${y}${m}${d}-${H}${M}`;
            const safeProjectName = projectName.replace(/[^a-z0-9_\-\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');

            if (isTauri()) {
                try {
                    // 拡張子判定
                    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
                    const filePath = await save({
                        defaultPath: `${safeProjectName}-${formattedDate}.${ext}`,
                        filters: [{
                            name: 'Video',
                            extensions: [ext]
                        }]
                    });

                    if (filePath) {
                        const arrayBuffer = await blob.arrayBuffer();
                        await writeFile(filePath, new Uint8Array(arrayBuffer));
                        alert("Video saved successfully!");
                    }
                } catch (err) {
                    console.error("Failed to save file in Tauri:", err);
                    alert("Failed to save video.");
                }
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const ext = mimeType.includes("mp4") ? "mp4" : "webm";
                a.download = `${safeProjectName}-${formattedDate}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }
            setIsRecording(false);
        };

        mediaRecorder.start(1000); 

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
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };
    setDancers([...dancers, newDancer]);
    setKeyframes(prev => prev.map(kf => ({
        ...kf,
        positions: { ...kf.positions, [newId]: { x: STAGE_WIDTH/2, y: STAGE_HEIGHT/2 } }
    })));
  };

  const removeDancer = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDancers(prev => prev.filter(d => d.id !== id));
    if (selectedDancerId === id) setSelectedDancerId(null);
  };

  const updateDancer = (id: string, updates: Partial<Dancer>) => {
    setDancers(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
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
                className={`flex items-center justify-center p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-semibold transition ${
                    isRecording 
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
          <div className={`absolute top-0 bottom-0 left-0 bg-gray-900 border-r border-gray-800 z-20 transition-all duration-300 ease-in-out flex flex-col shadow-2xl touch-pan-y ${isSidebarOpen ? 'w-full sm:w-72 translate-x-0' : 'w-72 -translate-x-full'}`}>
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">Cast</h2>
                <div className="flex items-center space-x-1">
                    <button onClick={addNewDancer} className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition"><Plus size={20} /></button>
                    <button onClick={() => setIsSidebarOpen(false)} className="sm:hidden p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition"><X size={20} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col">
                <div className="space-y-2 flex-1">
                    {dancers.map(dancer => (
                        <div key={dancer.id} onClick={() => setSelectedDancerId(dancer.id)} className={`flex items-center justify-between p-2 rounded border transition cursor-pointer ${selectedDancerId === dancer.id ? 'bg-indigo-900/40 border-indigo-500/50 shadow-sm' : 'bg-gray-800/50 border-gray-800 hover:bg-gray-800'}`}>
                            <div className="flex items-center space-x-3 flex-1">
                                <input type="color" value={dancer.color} onChange={(e) => updateDancer(dancer.id, { color: e.target.value })} className="w-5 h-5 rounded-full overflow-hidden border-0 p-0 bg-transparent cursor-pointer shrink-0" />
                                <input type="text" value={dancer.name} onChange={(e) => updateDancer(dancer.id, { name: e.target.value })} className={`bg-transparent border-none focus:outline-none text-sm font-medium w-full ${selectedDancerId === dancer.id ? 'text-white' : 'text-gray-300'}`} onClick={(e) => e.stopPropagation()} placeholder="Name" />
                            </div>
                            <button onClick={(e) => removeDancer(dancer.id, e)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition"><Trash2 size={14} /></button>
                        </div>
                    ))}
                </div>
                <button onClick={addNewDancer} className="w-full py-2.5 mt-4 border border-dashed border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 hover:bg-gray-800 transition flex items-center justify-center space-x-2 text-sm font-medium"><Plus size={16} /><span>Add Member</span></button>
            </div>
          </div>

          <main className={`flex-1 bg-gray-950 flex flex-col relative overflow-hidden transition-all duration-300 min-h-0 ${isSidebarOpen ? 'sm:ml-72' : 'ml-0'}`}>
             {isSidebarOpen && <div className="absolute inset-0 bg-black/50 z-10 sm:hidden" onClick={() => setIsSidebarOpen(false)} />}
            <div className="relative w-full h-full flex flex-col">
                <div className="h-10 border-b border-gray-800 bg-gray-900 flex items-center justify-end px-4 z-20 shrink-0">
                     <div className="flex items-center space-x-3 group">
                        <div className="flex items-center space-x-2 bg-gray-800 rounded px-2 py-1 mr-2">
                             <Search size={14} className="text-gray-400" />
                             <input type="range" min="0.1" max="3" step="0.1" value={zoomLevel} onChange={(e) => setZoomLevel(parseFloat(e.target.value))} className="w-20 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                        </div>
                        <button onClick={() => setIsSnapEnabled(!isSnapEnabled)} className={`p-1.5 rounded transition flex items-center justify-center ${isSnapEnabled ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}><Magnet size={18} /></button>
                        <div className="w-px h-4 bg-gray-700 mx-2" />
                        <div className="flex items-center space-x-2"><Grid size={16} className="text-gray-400" /><select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))} className="bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 px-2 py-1 focus:outline-none focus:border-indigo-500">{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(size => (<option key={size} value={size}>{size === 0 ? "Off" : `${size}px`}</option>))}</select></div>
                     </div>
                </div>
                <div className="relative flex-1 w-full overflow-hidden bg-gray-950">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-full h-full">
                            <Stage ref={stageRef} dancers={dancers} positions={currentPositions} onPositionChange={handlePositionChange} isRecording={isRecording} selectedDancerId={selectedDancerId} onSelectDancer={setSelectedDancerId} gridSize={gridSize} snapToGrid={isSnapEnabled} zoom={zoomLevel} onZoomChange={setZoomLevel} />
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