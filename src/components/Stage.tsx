import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Dancer, Position, STAGE_WIDTH, STAGE_HEIGHT } from '../types';

interface StageProps {
  dancers: Dancer[];
  positions: Record<string, Position>;
  onPositionChange: (dancerId: string, newPos: Position) => void;
  isRecording: boolean;
  selectedDancerId: string | null;
  onSelectDancer: (id: string | null) => void;
  gridSize: number;
  snapToGrid: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

export interface StageRef {
    getCanvasStream: () => MediaStream;
    resetView: () => void;
}

// 少し狭くしたWing（半分）
const WINGS_WIDTH = 125; 

const Stage = forwardRef<StageRef, StageProps>(({ 
  dancers, 
  positions, 
  onPositionChange, 
  isRecording,
  selectedDancerId,
  onSelectDancer,
  gridSize,
  snapToGrid,
  zoom,
  onZoomChange
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [draggedDancerId, setDraggedDancerId] = useState<string | null>(null);
  
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const prevPanPointRef = useRef<{ x: number, y: number } | null>(null);
  const isDraggingViewRef = useRef(false);

  // --- 1. サイズ変更検知（偶数サイズを徹底する） ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            // Macの録画機能のために、必ず「偶数」にする
            const w = Math.floor(width);
            const h = Math.floor(height);
            setCanvasSize({ 
                w: w % 2 === 0 ? w : w - 1, 
                h: h % 2 === 0 ? h : h - 1 
            });
        }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // --- 2. 初期フィット ---
  useEffect(() => {
    if (canvasSize.w > 0 && canvasSize.h > 0 && transform.k === 1 && transform.x === 0) {
        fitStageToCanvas();
    }
  }, [canvasSize]); 

  // --- 3. ズーム連動 ---
  useEffect(() => {
    if (typeof zoom === 'number' && canvasSize.w > 0 && Math.abs(zoom - transform.k) > 0.001) {
        const cx = canvasSize.w / 2;
        const cy = canvasSize.h / 2;
        const newX = cx - (cx - transform.x) * (zoom / transform.k);
        const newY = cy - (cy - transform.y) * (zoom / transform.k);
        setTransform({ x: newX, y: newY, k: zoom });
    }
  }, [zoom, canvasSize.w, canvasSize.h]);

  // 安全なフィット関数（少し余白を持たせる）
  const fitStageToCanvas = () => {
      if (canvasSize.w === 0 || canvasSize.h === 0) return;
      
      const padding = 20; // ★少しだけ余白を持たせてエラー回避
      const availableW = canvasSize.w - padding * 2;
      const availableH = canvasSize.h - padding * 2;
      
      const totalWidth = STAGE_WIDTH + WINGS_WIDTH * 2;
      
      // 全体（Wing込み）が収まるように計算
      const scale = Math.min(availableW / totalWidth, availableH / STAGE_HEIGHT);
      
      // 中央寄せ
      const x = (canvasSize.w - STAGE_WIDTH * scale) / 2;
      const y = (canvasSize.h - STAGE_HEIGHT * scale) / 2;
      
      setTransform({ x, y, k: scale });
      onZoomChange?.(scale);
  };

  // --- 4. 外部公開メソッド ---
  useImperativeHandle(ref, () => ({
    getCanvasStream: () => {
        if (canvasRef.current) {
            // ストリーム取得
            return canvasRef.current.captureStream();
        }
        throw new Error("Canvas not initialized");
    },
    resetView: () => {
        fitStageToCanvas(); // 安全版のフィット関数を使う
    }
  }));

  // --- 5. 描画ループ ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ★重要: alpha: false で不透明化して録画バグを防ぐ
    // ★重要: Macアプリ対策セット
    // willReadFrequently: true -> これが決定打！GPUを使わずCPUで描画させ、確実に録画できるようにする
    // preserveDrawingBuffer: true -> 念のため、描画バッファが消えないようにする
    const ctx = canvas.getContext('2d', { 
        alpha: false,
        willReadFrequently: true,
        preserveDrawingBuffer: true
    });

    // 画面クリア
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f172a'; // 背景色
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 変換適用
    ctx.setTransform(transform.k, 0, 0, transform.k, transform.x, transform.y);

    // === ここから描画 ===
    
    // Wings
    ctx.fillStyle = '#1e293b'; 
    ctx.fillRect(-WINGS_WIDTH, 0, WINGS_WIDTH, STAGE_HEIGHT);
    ctx.fillRect(STAGE_WIDTH, 0, WINGS_WIDTH, STAGE_HEIGHT);

    // Stage
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    
    // Border
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2 / transform.k;
    ctx.strokeRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const centerX = STAGE_WIDTH / 2;
    const centerY = STAGE_HEIGHT / 2;

    // Grid
    if (gridSize > 0) {
        const drawGridLines = (start: number, end: number, step: number, isVertical: boolean, isWing: boolean) => {
             ctx.strokeStyle = isWing ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.5)';
             ctx.lineWidth = 1 / transform.k;
             const offset = isVertical ? centerX % step : centerY % step;
             const firstLine = Math.floor((start - offset) / step) * step + offset;

             ctx.beginPath();
             for (let val = firstLine; val <= end; val += step) {
                 if (isVertical) {
                     ctx.moveTo(val, 0);
                     ctx.lineTo(val, STAGE_HEIGHT);
                 } else {
                     ctx.moveTo(-WINGS_WIDTH, val);
                     ctx.lineTo(STAGE_WIDTH + WINGS_WIDTH, val);
                 }
             }
             ctx.stroke();
        };

        drawGridLines(-WINGS_WIDTH, 0, gridSize, true, true);
        drawGridLines(STAGE_WIDTH, STAGE_WIDTH + WINGS_WIDTH, gridSize, true, true);
        drawGridLines(0, STAGE_WIDTH, gridSize, true, false);
        drawGridLines(0, STAGE_HEIGHT, gridSize, false, false);
    }

    // Center Cross
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3 / transform.k;
    const crossSize = gridSize > 0 ? gridSize : 50;
    ctx.moveTo(centerX, centerY - crossSize);
    ctx.lineTo(centerX, centerY + crossSize);
    ctx.moveTo(centerX - crossSize, centerY);
    ctx.lineTo(centerX + crossSize, centerY);
    ctx.moveTo(0, STAGE_HEIGHT);
    ctx.lineTo(STAGE_WIDTH, STAGE_HEIGHT);
    ctx.stroke();

    // Numbers
    if (gridSize >= 20) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = `bold 14px sans-serif`; 
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const numberY = STAGE_HEIGHT - 5;
        ctx.fillText("0", centerX + 5, numberY);
        let count = 1;
        for (let x = centerX + gridSize; x < STAGE_WIDTH; x += gridSize) {
             ctx.fillText(count.toString(), x, numberY);
             ctx.fillText(count.toString(), centerX - (x - centerX), numberY);
             count++;
        }
    }

    // Dancers
    dancers.forEach((dancer) => {
      const pos = positions[dancer.id] || { x: 0, y: 0 };
      const isSelected = selectedDancerId === dancer.id;
      const isDragging = draggedDancerId === dancer.id;
      
      // Shadow
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + 5, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();

      // Selection Glow
      if (isSelected || isDragging) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250, 204, 21, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 2 / transform.k;
        ctx.stroke();
      }

      // Body
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = dancer.color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = (isSelected ? 3 : 1) / transform.k;
      ctx.stroke();

      // Initial
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `bold 12px sans-serif`; 
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dancer.name.substring(0, 1).toUpperCase(), pos.x, pos.y);

      // Full Name
      const screenFontSize = 14; 
      const worldFontSize = Math.max(1, screenFontSize / transform.k);
      ctx.font = `bold ${worldFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelY = pos.y + 20;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 3 / transform.k;
      ctx.strokeText(dancer.name, pos.x, labelY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(dancer.name, pos.x, labelY);
    });

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("WING L", -WINGS_WIDTH / 2, STAGE_HEIGHT / 2);
    ctx.fillText("WING R", STAGE_WIDTH + WINGS_WIDTH / 2, STAGE_HEIGHT / 2);

  }, [dancers, positions, draggedDancerId, isRecording, selectedDancerId, gridSize, transform, canvasSize]);

  // --- 6. イベントハンドラ ---
  const screenToWorld = (sx: number, sy: number) => {
      return {
          x: (sx - transform.x) / transform.k,
          y: (sy - transform.y) / transform.k
      };
  };

  const calculateSnap = (val: number, centerVal: number) => {
      if (gridSize <= 1) return val;
      const offset = centerVal % gridSize;
      return Math.round((val - offset) / gridSize) * gridSize + offset;
  };

  const handleWheel = (e: React.WheelEvent) => {
      if (draggedDancerId) return;
      const zoomIntensity = 0.001;
      const newScale = Math.min(5, Math.max(0.1, transform.k * (1 - e.deltaY * zoomIntensity)));
      const rect = canvasRef.current!.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const worldX = (pointerX - transform.x) / transform.k;
      const worldY = (pointerY - transform.y) / transform.k;
      const newX = pointerX - worldX * newScale;
      const newY = pointerY - worldY * newScale;
      setTransform({ x: newX, y: newY, k: newScale });
      onZoomChange?.(newScale);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = canvasRef.current!.getBoundingClientRect();
    pointersRef.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    
    if (pointersRef.current.size === 1) {
        const { x: wx, y: wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        let hitId = null;
        for (let i = dancers.length - 1; i >= 0; i--) {
            const d = dancers[i];
            const p = positions[d.id];
            if (p) {
                const dist = Math.sqrt(Math.pow(wx - p.x, 2) + Math.pow(wy - p.y, 2));
                if (dist <= 35) {
                    hitId = d.id;
                    break;
                }
            }
        }
        if (hitId) {
            setDraggedDancerId(hitId);
            onSelectDancer(hitId);
            isDraggingViewRef.current = false;
        } else {
            onSelectDancer(null);
            isDraggingViewRef.current = true;
            prevPanPointRef.current = { x: e.clientX, y: e.clientY };
        }
    } else {
        setDraggedDancerId(null);
        isDraggingViewRef.current = true;
        if (pointersRef.current.size === 2) {
            const values = Array.from(pointersRef.current.values());
            const p1 = values[0] as { x: number, y: number };
            const p2 = values[1] as { x: number, y: number };
            const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            prevPinchDistRef.current = dist;
            prevPanPointRef.current = {
                x: (p1.x + p2.x) / 2 + rect.left,
                y: (p1.y + p2.y) / 2 + rect.top
            };
        }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: currentX, y: currentY });
    }

    if (draggedDancerId && pointersRef.current.size === 1) {
        let { x, y } = screenToWorld(currentX, currentY);
        if (snapToGrid) {
            x = calculateSnap(x, STAGE_WIDTH / 2);
            y = calculateSnap(y, STAGE_HEIGHT / 2);
        }
        x = Math.max(-WINGS_WIDTH + 20, Math.min(STAGE_WIDTH + WINGS_WIDTH - 20, x));
        y = Math.max(20, Math.min(STAGE_HEIGHT - 20, y));
        onPositionChange(draggedDancerId, { x, y });
        return;
    }

    if (isDraggingViewRef.current) {
        if (pointersRef.current.size === 2) {
            const values = Array.from(pointersRef.current.values());
            const p1 = values[0];
            const p2 = values[1];
            const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            
            if (prevPinchDistRef.current && prevPanPointRef.current) {
                const scaleFactor = dist / prevPinchDistRef.current;
                const newScale = Math.min(5, Math.max(0.1, transform.k * scaleFactor));
                const clientCenter = { x: center.x + rect.left, y: center.y + rect.top };
                const deltaX = clientCenter.x - prevPanPointRef.current.x;
                const deltaY = clientCenter.y - prevPanPointRef.current.y;
                const wx = (center.x - transform.x) / transform.k;
                const wy = (center.y - transform.y) / transform.k;
                const newX = center.x - wx * newScale + deltaX;
                const newY = center.y - wy * newScale + deltaY;
                setTransform({ x: newX, y: newY, k: newScale });
                onZoomChange?.(newScale);
                prevPanPointRef.current = clientCenter;
            }
            prevPinchDistRef.current = dist;
        } 
        else if (pointersRef.current.size === 1 && prevPanPointRef.current) {
             const deltaX = e.clientX - prevPanPointRef.current.x;
             const deltaY = e.clientY - prevPanPointRef.current.y;
             setTransform(prev => ({ ...prev, x: prev.x + deltaX, y: prev.y + deltaY }));
             prevPanPointRef.current = { x: e.clientX, y: e.clientY };
        }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (pointersRef.current.size === 0) {
        setDraggedDancerId(null);
        isDraggingViewRef.current = false;
        prevPinchDistRef.current = null;
        prevPanPointRef.current = null;
    } else if (pointersRef.current.size === 1) {
        const p = pointersRef.current.values().next().value as { x: number, y: number };
        const rect = canvasRef.current!.getBoundingClientRect();
        prevPanPointRef.current = { x: p.x + rect.left, y: p.y + rect.top };
        prevPinchDistRef.current = null;
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950 relative overflow-hidden touch-none">
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="block cursor-crosshair touch-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
});

export default Stage;