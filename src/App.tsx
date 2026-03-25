import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Dancer, Keyframe, Position, Group, STAGE_WIDTH, STAGE_HEIGHT } from './types';
import Timeline from './components/Timeline';
import Stage, { StageRef } from './components/Stage';
import { GroupList } from './components/GroupList';
import { useHistory } from './hooks/useHistory';
import { useAudio } from './hooks/useAudio';
import { usePlayback } from './hooks/usePlayback';
import { useRecording } from './hooks/useRecording';
import { useKeyframeEditor } from './hooks/useKeyframeEditor';
import { useGroupDancer } from './hooks/useGroupDancer';
import { useProjectIO } from './hooks/useProjectIO';
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

const INITIAL_STATE = {
  dancers: INITIAL_DANCERS,
  keyframes: [{ id: 'start', timestamp: 0, positions: INITIAL_POSITIONS }] as Keyframe[],
  groups: [] as Group[],
};

function App() {
  // --- History ---
  const {
    state: historyState,
    pushState,
    undo,
    redo,
    canUndo,
    canRedo,
    set: setHistory,
  } = useHistory(INITIAL_STATE);

  // Sync state from history
  const dancers = historyState.dancers;
  const keyframes = historyState.keyframes;
  const groups = historyState.groups;

  // --- UI State ---
  const [selectedDancerIds, setSelectedDancerIds] = useState<Set<string>>(new Set());
  const [projectName, setProjectName] = useState('Untitled Project');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(true);
  const [gridSize, setGridSize] = useState(50);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isMultiSelectionEnabled, setIsMultiSelectionEnabled] = useState(false);
  const stageRef = useRef<StageRef>(null);

  // --- Hooks ---
  const audio = useAudio();
  const playback = usePlayback(audio.audioRef, audio.audioFile);
  const recording = useRecording(projectName);
  const { saveProject, loadProject } = useProjectIO();

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
      }
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

  // --- Audio Play/Pause sync ---
  useEffect(() => {
    const audioEl = audio.audioRef.current;
    if (!audioEl || !audio.audioFile) return;

    if (playback.isPlaying) {
      if (Math.abs(audioEl.currentTime * 1000 - playback.currentTime) > 100) {
        audioEl.currentTime = playback.currentTime / 1000;
      }
      if (audio.audioContextRef.current?.state === 'suspended') {
        audio.audioContextRef.current.resume();
      }
      audioEl.play().catch(e => console.error('Audio play failed:', e));
    } else {
      audioEl.pause();
    }
  }, [playback.isPlaying, audio.audioFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Responsive sidebar ---
  useEffect(() => {
    const handleResize = () => {
      setIsSidebarOpen(window.innerWidth >= 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Interpolation ---
  const sortedKeyframes = useMemo(
    () => [...keyframes].sort((a, b) => a.timestamp - b.timestamp),
    [keyframes]
  );

  const getCurrentPositions = useCallback((): Record<string, Position> => {
    let prevKf = sortedKeyframes[0];
    let nextKf = sortedKeyframes[sortedKeyframes.length - 1];

    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].timestamp <= playback.currentTime) {
        prevKf = sortedKeyframes[i];
      }
      if (sortedKeyframes[i].timestamp >= playback.currentTime) {
        nextKf = sortedKeyframes[i];
        break;
      }
    }

    if (prevKf.id === nextKf.id) return prevKf.positions;

    const totalDuration = nextKf.timestamp - prevKf.timestamp;
    const elapsed = playback.currentTime - prevKf.timestamp;
    const progress = Math.min(1, Math.max(0, elapsed / totalDuration));

    const interpolated: Record<string, Position> = {};
    dancers.forEach(dancer => {
      const startPos = prevKf.positions[dancer.id] || { x: 0, y: 0 };
      const endPos = nextKf.positions[dancer.id] || startPos;

      const controlPoint = prevKf.controlPoints?.[dancer.id];
      if (controlPoint) {
        const t = progress;
        const invT = 1 - t;
        interpolated[dancer.id] = {
          x: invT * invT * startPos.x + 2 * invT * t * controlPoint.x + t * t * endPos.x,
          y: invT * invT * startPos.y + 2 * invT * t * controlPoint.y + t * t * endPos.y,
        };
      } else {
        interpolated[dancer.id] = {
          x: startPos.x + (endPos.x - startPos.x) * progress,
          y: startPos.y + (endPos.y - startPos.y) * progress,
        };
      }
    });
    return interpolated;
  }, [playback.currentTime, sortedKeyframes, dancers]);

  const currentPositions = getCurrentPositions();

  // --- Active Bezier Paths ---
  const activePaths = useMemo(() => {
    if (selectedDancerIds.size === 0) return [];

    let prevKf = sortedKeyframes[0];
    let nextKf = sortedKeyframes[sortedKeyframes.length - 1];

    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].timestamp <= playback.currentTime) {
        prevKf = sortedKeyframes[i];
      }
      if (sortedKeyframes[i].timestamp > playback.currentTime) {
        nextKf = sortedKeyframes[i];
        break;
      }
    }

    if (prevKf.id === nextKf.id) return [];

    const paths: {
      keyframeId: string;
      dancerId: string;
      startPos: Position;
      endPos: Position;
      controlPoint: Position;
    }[] = [];

    selectedDancerIds.forEach(id => {
      const startPos = prevKf.positions[id];
      const endPos = nextKf.positions[id];
      if (startPos && endPos) {
        let cp = prevKf.controlPoints?.[id];
        if (!cp) {
          cp = { x: (startPos.x + endPos.x) / 2, y: (startPos.y + endPos.y) / 2 };
        }
        paths.push({ keyframeId: prevKf.id, dancerId: id, startPos, endPos, controlPoint: cp });
      }
    });
    return paths;
  }, [selectedDancerIds, sortedKeyframes, playback.currentTime]);

  // --- Keyframe Editor ---
  const keyframeEditor = useKeyframeEditor(
    dancers, keyframes, groups,
    { pushState, undo, redo, canUndo, canRedo, set: setHistory },
    playback.setCurrentTime,
    playback.handleSeek,
  );

  // --- Group & Dancer Management ---
  const groupDancer = useGroupDancer(dancers, keyframes, groups, {
    pushState, undo, redo, canUndo, canRedo, set: setHistory,
  });

  // --- Position change handlers (bridge to keyframe editor) ---
  const handlePositionChange = (dancerId: string, newPos: Position) => {
    playback.setIsPlaying(false);
    keyframeEditor.handlePositionChange(dancerId, newPos, playback.currentTime, currentPositions);
  };

  const handleMultiPositionChange = (changes: Record<string, Position>) => {
    playback.setIsPlaying(false);
    keyframeEditor.handleMultiPositionChange(changes, playback.currentTime, currentPositions);
  };

  const handleControlPointChange = (keyframeId: string, dancerId: string, newCP: Position) => {
    playback.setIsPlaying(false);
    keyframeEditor.handleControlPointChange(keyframeId, dancerId, newCP);
  };

  // --- Seek with playback stop ---
  const handleSeek = (time: number) => {
    playback.handleSeek(time);
  };

  // --- Recording ---
  const handleStartRecording = () => {
    recording.startRecording(
      stageRef,
      audio.audioDestNodeRef.current,
      audio.audioRef,
      audio.audioFile,
    );
  };

  // --- Project IO ---
  const handleSaveProject = () => {
    saveProject({
      projectName,
      dancers,
      keyframes,
      duration: playback.duration,
      audioFileName: audio.audioFileName,
    });
  };

  const handleLoadProject = () => {
    loadProject({
      setProjectName,
      setDancers: (d: Dancer[]) => setHistory({ ...historyState, dancers: d }),
      setKeyframes: (k: Keyframe[]) => setHistory({ ...historyState, keyframes: k }),
      setDuration: playback.setDuration,
      setAudioFileName: () => {},
      setAudioFile: () => {},
      setAudioBuffer: () => {},
      setHistory,
    });
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-950 text-white font-sans overflow-hidden touch-none">
      {/* Hidden Audio Element */}
      <audio
        ref={audio.audioRef}
        src={audio.audioFile || undefined}
        crossOrigin="anonymous"
        className="hidden"
        preload="auto"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration * 1000;
          if (d && !isNaN(d) && d > 0) {
            playback.setDuration(Math.ceil(d));
          }
        }}
        onError={(e) => console.error('Audio Load Error', e)}
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
              onClick={handleLoadProject}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition"
              title="Load Project"
            >
              <FolderOpen size={18} />
            </button>
            <button
              onClick={handleSaveProject}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition"
              title="Save Project"
            >
              <Save size={18} />
            </button>
          </div>

          <button
            onClick={recording.isRecording ? recording.stopRecording : handleStartRecording}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${recording.isRecording
              ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
          >
            {recording.isRecording ? (
              <>
                <div className="w-3 h-3 bg-white rounded-full" />
                Stop
              </>
            ) : (
              <>
                <Video size={16} />
                <span className="hidden sm:inline">Record</span>
              </>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        {isSidebarOpen && (
          <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 z-20 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:top-[57px] max-md:bottom-0 shadow-2xl max-md:z-30">
            {/* Sidebar Header */}
            <div className="p-3 border-b border-gray-800 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="flex-1 bg-gray-800 text-white px-3 py-1.5 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none text-sm font-medium"
                  placeholder="Project Name"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGridSize(g => Math.max(10, g - 10))}
                  className="p-1.5 bg-gray-800 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition text-xs"
                  title="Decrease Grid"
                >
                  <Grid size={14} />
                </button>
                <span className="text-xs text-gray-500 font-mono flex-1">Grid: {gridSize}px</span>
                <button
                  onClick={() => setGridSize(g => Math.min(100, g + 10))}
                  className="p-1.5 bg-gray-800 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition text-xs"
                  title="Increase Grid"
                >
                  <Grid size={14} />
                </button>
                <button
                  onClick={() => setIsSnapEnabled(!isSnapEnabled)}
                  className={`p-1.5 rounded-lg transition text-xs ${isSnapEnabled ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                  title="Snap to Grid"
                >
                  <Magnet size={14} />
                </button>
              </div>
            </div>

            {/* Group List */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-slate-900">
              <GroupList
                groups={groups}
                dancers={dancers}
                onAddGroup={groupDancer.handleAddGroup}
                onUpdateGroup={groupDancer.handleUpdateGroup}
                onDeleteGroup={groupDancer.handleDeleteGroup}
                onAssignDancerToGroup={groupDancer.handleAssignDancerToGroup}
                onToggleSolo={groupDancer.handleToggleSolo}
                onAddDancer={groupDancer.addNewDancer}
                onDeleteDancer={groupDancer.removeDancer}
              />
            </div>
          </div>
        )}

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
                    <Undo2 size={16} />
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    className={`flex items-center justify-center w-10 h-10 sm:w-auto sm:h-auto sm:gap-1 sm:px-3 sm:py-1.5 rounded-lg text-sm font-medium transition ${canRedo ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white active:bg-gray-600' : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'}`}
                    title="Redo (Cmd+Shift+Z)"
                  >
                    <Redo2 size={16} />
                  </button>
                </div>
                <button
                  onClick={() => setIsMultiSelectionEnabled(!isMultiSelectionEnabled)}
                  className={`p-2 rounded-lg transition ${isMultiSelectionEnabled ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                  title="Multi-Select Mode"
                >
                  <Search size={16} />
                </button>
                <span className="text-xs text-gray-500">{Math.round(zoomLevel * 100)}%</span>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <Stage
                ref={stageRef}
                dancers={dancers}
                positions={currentPositions}
                onPositionChange={handlePositionChange}
                onMultiPositionChange={handleMultiPositionChange}
                isRecording={recording.isRecording}
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
        </main>
      </div>

      <div className={`shrink-0 z-30 transition-all duration-300 bg-gray-900 border-t border-gray-800 flex flex-col ${isTimelineExpanded ? 'h-48' : 'h-12'}`}>
        <div className="h-0 flex justify-center -translate-y-3">
          <button onClick={() => setIsTimelineExpanded(!isTimelineExpanded)} className="bg-gray-800 border border-gray-700 rounded-full p-1 hover:bg-gray-700 text-gray-400 shadow-md z-40">
            {isTimelineExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
        <div className={isTimelineExpanded ? 'h-full' : 'hidden'}>
          <Timeline
            duration={playback.duration}
            setDuration={playback.setDuration}
            currentTime={playback.currentTime}
            isPlaying={playback.isPlaying}
            keyframes={keyframes}
            onSeek={handleSeek}
            onTogglePlay={() => {
              if (playback.isPlaying && recording.isRecording) recording.stopRecording();
              playback.setIsPlaying(!playback.isPlaying);
            }}
            onAddKeyframe={() => keyframeEditor.handleAddKeyframe(playback.currentTime, currentPositions)}
            onDeleteKeyframe={keyframeEditor.handleDeleteKeyframe}
            onUpdateKeyframeTime={keyframeEditor.handleUpdateKeyframeTime}
            onJumpPrev={() => keyframeEditor.handleJumpPrevKeyframe(sortedKeyframes, playback.currentTime)}
            onJumpNext={() => keyframeEditor.handleJumpNextKeyframe(sortedKeyframes, playback.currentTime)}
            onAudioUpload={audio.handleAudioUpload}
            audioFileName={audio.audioFileName}
            audioBuffer={audio.audioBuffer}
          />
        </div>
        {!isTimelineExpanded && (
          <div className="flex items-center justify-between px-4 h-full">
            <div className="flex items-center space-x-2">
              <button onClick={() => handleSeek(0)} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipBack size={16} /></button>
              <button onClick={() => keyframeEditor.handleJumpPrevKeyframe(sortedKeyframes, playback.currentTime)} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipBack size={16} className="rotate-180 transform -scale-x-100" /></button>
              <button onClick={() => playback.setIsPlaying(!playback.isPlaying)} className="p-1.5 rounded-full bg-gray-800 text-white hover:bg-gray-700 transition">{playback.isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
              <button onClick={() => keyframeEditor.handleJumpNextKeyframe(sortedKeyframes, playback.currentTime)} className="p-1.5 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition"><SkipForward size={16} /></button>
            </div>
            <div className="flex items-center space-x-2"><span className="text-xs font-mono text-gray-400">{(playback.currentTime / 1000).toFixed(2)}s / {(playback.duration / 1000).toFixed(0)}s</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
