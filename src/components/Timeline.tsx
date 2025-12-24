import React, { useRef, useMemo, useState, useEffect, useLayoutEffect } from 'react';
import { Keyframe } from '../types';
import { Play, Pause, Plus, Trash2, SkipBack, Clock, SkipForward, Music, ZoomIn, ZoomOut } from 'lucide-react';

interface TimelineProps {
  duration: number;
  setDuration: (ms: number) => void;
  currentTime: number;
  isPlaying: boolean;
  keyframes: Keyframe[];
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: (id: string) => void;
  onUpdateKeyframeTime: (id: string, newTime: number) => void;
  onJumpPrev: () => void;
  onJumpNext: () => void;
  onAudioUpload: (file: File) => void;
  audioFileName: string | null;
  audioBuffer: AudioBuffer | null;
}

const Timeline: React.FC<TimelineProps> = ({
  duration,
  setDuration,
  currentTime,
  isPlaying,
  keyframes,
  onSeek,
  onTogglePlay,
  onAddKeyframe,
  onDeleteKeyframe,
  onUpdateKeyframeTime,
  onJumpPrev,
  onJumpNext,
  onAudioUpload,
  audioFileName,
  audioBuffer
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingKeyframeId, setDraggingKeyframeId] = useState<string | null>(null);
  const [isDraggingScrubber, setIsDraggingScrubber] = useState(false);
  const [zoom, setZoom] = useState(1);

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 20;

  // Touch states for zoom
  const [touchDist, setTouchDist] = useState<number | null>(null);
  const pendingScrollRef = useRef<number | null>(null);

  const [_, setResizeTrigger] = useState(0);

  // Apply pending scroll synchronously after layout update
  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = pendingScrollRef.current;
        pendingScrollRef.current = null;
    }
  }, [zoom]);

  // Auto-scroll to keep playhead in view
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const contentWidth = container.scrollWidth;
    const playheadX = (currentTime / duration) * contentWidth;

    const scrollLeft = container.scrollLeft;
    const rightEdge = scrollLeft + containerWidth;
    const leftEdge = scrollLeft;

    // If playhead is out of view (with a small buffer), scroll to center it
    const buffer = 20;

    if (playheadX > rightEdge - buffer || playheadX < leftEdge + buffer) {
        container.scrollLeft = playheadX - (containerWidth / 2);
    }
  }, [currentTime, duration]);

  // Global Mouse Up to stop dragging anything
  useEffect(() => {
    const handleUp = () => {
      setDraggingKeyframeId(null);
      setIsDraggingScrubber(false);
    };
    const handleMove = (e: MouseEvent) => {
        if (!timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        const newTime = Math.round(percentage * duration);

        if (draggingKeyframeId) {
            onUpdateKeyframeTime(draggingKeyframeId, newTime);
        } else if (isDraggingScrubber) {
            onSeek(newTime);
        }
    };

    if (draggingKeyframeId || isDraggingScrubber) {
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('mousemove', handleMove);
    }
    return () => {
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('mousemove', handleMove);
    };
  }, [draggingKeyframeId, isDraggingScrubber, duration, onUpdateKeyframeTime, onSeek]);

  // Handle Resize for Canvas
  useEffect(() => {
      const handleResize = () => {
          setResizeTrigger(prev => prev + 1);
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Waveform Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timelineRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas size sync
    const rect = timelineRef.current.getBoundingClientRect();
    // Prevent 0 width canvas errors
    canvas.width = Math.max(1, rect.width);
    canvas.height = Math.max(1, rect.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!audioBuffer) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    const data = audioBuffer.getChannelData(0);
    // duration (ms) -> samples: audioBuffer.sampleRate * (duration / 1000)
    // We only want to draw up to `duration`, not the whole file if it's longer
    const totalSamplesToDraw = Math.floor(audioBuffer.sampleRate * (duration / 1000));
    const samplesPerPixel = totalSamplesToDraw / width;
    const amp = height / 2;

    ctx.fillStyle = '#4f46e5'; // Indigo-600
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;

        const startIndex = Math.floor(i * samplesPerPixel);
        const endIndex = Math.floor((i + 1) * samplesPerPixel);
        // Ensure we inspect at least one sample even if zoomed in deeply
        const loopEnd = Math.max(startIndex + 1, endIndex);

        if (startIndex >= data.length) break;

        for (let j = startIndex; j < loopEnd; j++) {
            if (j >= data.length) break;
            const datum = data[j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }

        // If we found no data (e.g. range was empty and start was out of bounds - though checked above),
        // or just to be safe if min > max because loop didn't run (unlikely with logic above)
        if (min > max) {
            min = 0;
            max = 0;
        }

        ctx.fillRect(i, centerY + min * amp, 1, Math.max(1, (max - min) * amp));
    }
  }, [audioBuffer, duration, zoom, _]);

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      // Only Left Click
      if (e.button !== 0) return;

      // If we clicked a keyframe, don't scrub
      if ((e.target as HTMLElement).closest('.keyframe-marker')) return;
      
      setIsDraggingScrubber(true);
      
      // Immediate seek on click
      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        onSeek(percentage * duration);
      }
  };

  const applyZoom = (targetZoom: number) => {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));

    if (newZoom !== zoom && scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth;
        const ratio = currentTime / duration;
        const scrollShift = ratio * containerWidth * (newZoom - zoom);
        const currentScroll = scrollContainerRef.current.scrollLeft;
        const targetScroll = currentScroll + scrollShift;

        pendingScrollRef.current = targetScroll;
        setZoom(newZoom);
    }
  };

  // Wheel Zoom Logic
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const scaleAmount = 0.1;
        applyZoom(zoom + (delta > 0 ? scaleAmount : -scaleAmount));
    }
  };

  // Touch Zoom Logic (Pinch)
  const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
          setTouchDist(dist);
      }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
      if (e.touches.length === 2 && touchDist !== null) {
          // Prevent browser zoom logic if any
          e.preventDefault();

          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));

          const diff = dist - touchDist;
          // 1px diff -> 0.01 zoom change
          const zoomChange = diff * 0.01;

          applyZoom(zoom + zoomChange);
          setTouchDist(dist); // Update dist so next move is relative to this
      }
  };

  const handleTouchEnd = () => {
      setTouchDist(null);
  };

  const handleZoomIn = () => {
    applyZoom(Math.floor(zoom * 2) / 2 + 0.5); // Steps of 0.5
  };

  const handleZoomOut = () => {
    applyZoom(Math.ceil(zoom * 2) / 2 - 0.5);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          onAudioUpload(e.target.files[0]);
          // Reset value to allow re-selecting same file
          e.target.value = '';
      }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const decimal = Math.floor((ms % 1000) / 100);
    return `${seconds}.${decimal}s`;
  };

  // Find active keyframe (exact match or close enough for UI indication)
  const activeKeyframe = useMemo(() => {
    return keyframes.find(k => Math.abs(k.timestamp - currentTime) < 50);
  }, [keyframes, currentTime]);

  const gridLines = useMemo(() => (
    Array.from({ length: 12 * Math.ceil(zoom) }).map((_, i) => (
      <div key={i} className="flex-1 border-r border-gray-800 first:border-l h-full opacity-30" />
    ))
  ), [zoom]);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-800 select-none">
      {/* Controls Header */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-3 bg-gray-800">
        <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-1 bg-gray-900 rounded-full p-1 border border-gray-700 shrink-0">
              <button
                onClick={() => onSeek(0)}
                className="p-1.5 sm:p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition"
                title="Reset to Start"
              >
                <SkipBack size={14} className="sm:w-4 sm:h-4" />
              </button>
              <button
                onClick={onJumpPrev}
                className="p-1.5 sm:p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition"
                title="Previous Keyframe"
              >
                 <SkipBack size={14} className="rotate-180 transform -scale-x-100 sm:w-4 sm:h-4" />
              </button>
              <button
                onClick={onTogglePlay}
                className={`p-1.5 sm:p-2 rounded-full text-white transition shadow-md mx-1 ${
                  isPlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isPlaying ? <Pause size={16} fill="currentColor" className="sm:w-5 sm:h-5" /> : <Play size={16} fill="currentColor" className="sm:w-5 sm:h-5" />}
              </button>
              <button
                onClick={onJumpNext}
                className="p-1.5 sm:p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition"
                title="Next Keyframe"
              >
                <SkipForward size={14} className="sm:w-4 sm:h-4" />
              </button>
            </div>
          
          <div className="flex flex-col hidden xs:flex">
              <span className="text-lg sm:text-xl font-mono text-white leading-none">
                {formatTime(currentTime)}
              </span>
              <span className="text-[9px] sm:text-[10px] text-gray-500 font-mono">
                  CURRENT
              </span>
          </div>
        </div>

        {/* Center: Duration & Audio */}
        <div className="flex items-center space-x-2 shrink-0">
            {/* Audio Upload */}
            <div className={`flex items-center bg-gray-900 rounded-lg px-2 py-1.5 border ${audioFileName ? 'border-indigo-500/50' : 'border-gray-700'}`}>
                <input 
                    type="file" 
                    ref={fileInputRef}
                    accept="audio/*, .mp3, .wav, .m4a, .aac, .ogg"
                    className="hidden"
                    onChange={handleFileChange}
                />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex items-center ${audioFileName ? 'text-indigo-400' : 'text-gray-400'} hover:text-white transition`}
                    title="Upload Music"
                >
                    {audioFileName ? (
                         <span className="text-xs font-medium max-w-[150px] truncate">{audioFileName}</span>
                    ) : (
                        <>
                            <Music size={14} className="mr-1 sm:mr-2" />
                            <span className="text-xs max-w-[80px] sm:max-w-[120px] truncate hidden sm:inline">Add Music</span>
                        </>
                    )}
                </button>
            </div>

            {/* Duration Input */}
            <div className="flex items-center bg-gray-900 rounded-lg px-2 py-1.5 border border-gray-700">
                <Clock size={14} className="text-gray-400 mr-1 sm:mr-2" />
                <span className="text-xs text-gray-400 mr-2 hidden sm:inline">MAX:</span>
                <input 
                    type="number" 
                    value={duration / 1000}
                    onChange={(e) => setDuration(Math.max(1, Number(e.target.value)) * 1000)}
                    className="w-10 sm:w-12 bg-transparent text-white text-sm font-mono focus:outline-none text-right"
                />
                <span className="text-xs text-gray-400 ml-1">s</span>
            </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
             {/* Zoom Buttons */}
             <div className="flex items-center bg-gray-900 rounded-lg border border-gray-700 p-0.5">
                <button
                    onClick={handleZoomOut}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
                    title="Zoom Out"
                    disabled={zoom <= MIN_ZOOM}
                >
                    <ZoomOut size={16} />
                </button>
                <button
                    onClick={handleZoomIn}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
                    title="Zoom In"
                    disabled={zoom >= MAX_ZOOM}
                >
                    <ZoomIn size={16} />
                </button>
             </div>

            {activeKeyframe ? (
                 <button
                 onClick={() => onDeleteKeyframe(activeKeyframe.id)}
                 className="flex items-center px-2 sm:px-3 py-2 bg-red-900/50 text-red-300 hover:bg-red-900 rounded border border-red-800 transition text-sm font-medium"
               >
                 <Trash2 size={16} className="mr-0 sm:mr-2" />
                 <span className="hidden sm:inline">Remove Keyframe</span>
               </button>
            ) : (
                <button
                onClick={onAddKeyframe}
                className="flex items-center px-2 sm:px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded transition text-sm font-medium shadow-sm"
              >
                <Plus size={16} className="mr-0 sm:mr-2" />
                 <span className="hidden sm:inline">Add Keyframe</span>
              </button>
            )}
        </div>
      </div>

      {/* Timeline Track Container - handles scrolling */}
      <div
        ref={scrollContainerRef}
        className="relative flex-1 px-4 py-6 overflow-x-auto overflow-y-hidden bg-gray-900 touch-pan-x"
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="min-w-full h-full relative" style={{ width: `${zoom * 100}%` }}>
            <div
                ref={timelineRef}
                className="relative w-full h-12 bg-gray-950 rounded border border-gray-800 cursor-pointer group"
                onMouseDown={handleTimelineMouseDown}
            >
                {/* Waveform Canvas */}
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full opacity-50 pointer-events-none"
                />

                {/* Grid Lines */}
                <div className="absolute inset-0 flex pointer-events-none">
                    {gridLines}
                </div>

                {/* Keyframe Markers */}
                {keyframes.map((kf) => (
                    <div
                        key={kf.id}
                        className={`keyframe-marker absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize z-20 group/marker flex flex-col items-center justify-center
                            ${draggingKeyframeId === kf.id ? 'z-30' : ''}
                        `}
                        style={{ left: `${(kf.timestamp / duration) * 100}%` }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingKeyframeId(kf.id);
                        }}
                        title={`Drag to move keyframe (${formatTime(kf.timestamp)})`}
                    >
                        {/* Top Diamond */}
                        <div className={`w-3 h-3 rotate-45 transform transition-all duration-75 shadow-sm
                            ${activeKeyframe?.id === kf.id || draggingKeyframeId === kf.id ? 'bg-yellow-400 scale-125' : 'bg-blue-500 hover:bg-blue-400'}
                        `} />

                        {/* Line */}
                        <div className={`w-0.5 flex-1 ${activeKeyframe?.id === kf.id || draggingKeyframeId === kf.id ? 'bg-yellow-400/50' : 'bg-blue-500/50'}`} />

                        {/* Bottom Diamond */}
                        <div className={`w-3 h-3 rotate-45 transform transition-all duration-75 shadow-sm
                            ${activeKeyframe?.id === kf.id || draggingKeyframeId === kf.id ? 'bg-yellow-400 scale-125' : 'bg-blue-500 hover:bg-blue-400'}
                        `} />
                    </div>
                ))}

                {/* Playhead */}
                <div
                    className={`absolute top-0 bottom-0 z-40 cursor-grab active:cursor-grabbing -ml-px group/playhead`}
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                    onMouseDown={(e) => {
                        e.stopPropagation(); // Prevent jumping
                        setIsDraggingScrubber(true);
                    }}
                >
                    {/* Hitbox for easier grabbing */}
                    <div className="absolute -left-3 -right-3 top-0 bottom-0 bg-transparent" />
                    
                    {/* Visual Line */}
                    <div className="w-0.5 h-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] relative">
                        {/* Head Handle */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-5 bg-red-500 rounded-sm shadow-md flex items-center justify-center z-50 hover:scale-110 transition-transform">
                            <div className="w-2 h-0.5 bg-red-200 rounded-full" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Time Scale Labels */}
            <div className="flex justify-between mt-1 text-[10px] text-gray-500 font-mono px-0.5">
                <span>0s</span>
                <span>{formatTime(duration / 2)}</span>
                <span>{formatTime(duration)}</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;