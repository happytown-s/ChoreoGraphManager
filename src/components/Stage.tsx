import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Dancer, Position, STAGE_WIDTH, STAGE_HEIGHT } from '../types';

interface StageProps {
  dancers: Dancer[];
  positions: Record<string, Position>;
  onPositionChange: (dancerId: string, newPos: Position) => void;
  onMultiPositionChange: (changes: Record<string, Position>) => void;
  isRecording: boolean;
  selectedDancerIds: Set<string>;
  onSelectDancers: (ids: Set<string>) => void;
  gridSize: number;
  snapToGrid: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

export interface StageRef {
    getCanvasStream: () => MediaStream;
    resetView: () => void;
}

// 袖エリアのサイズ
const WINGS_WIDTH = 125; // 左右の袖
const WING_TOP = 100;    // 上（奥）の袖
const WING_BOTTOM = 100; // 下（手前）の袖

// 録画用キャンバスのスケール（高解像度化）
const REC_SCALE = 2;

const Stage = forwardRef<StageRef, StageProps>(({
  dancers,
  positions,
  onPositionChange,
  onMultiPositionChange,
  isRecording,
  selectedDancerIds,
  onSelectDancers,
  gridSize,
  snapToGrid,
  zoom,
  onZoomChange
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 録画専用のCanvas
  const recordingCanvasRef = useRef<HTMLCanvasElement>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDraggingDancers, setIsDraggingDancers] = useState(false);

  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const prevPanPointRef = useRef<{ x: number, y: number } | null>(null);
  const isDraggingViewRef = useRef(false);

  // Multi-dancer drag state (ref-based for performance)
  const multiDragStateRef = useRef<{
    dragging: boolean;
    anchorWorld: { x: number, y: number };
    startPositions: Record<string, Position>;
    currentOffsets: Record<string, Position>;
  } | null>(null);

  // Rectangle selection state
  const selectionBoxRef = useRef<{
    active: boolean;
    startScreen: { x: number, y: number };
    currentScreen: { x: number, y: number };
  } | null>(null);

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

      const padding = 20;
      const availableW = canvasSize.w - padding * 2;
      const availableH = canvasSize.h - padding * 2;

      const totalWidth = STAGE_WIDTH + WINGS_WIDTH * 2;
      const totalHeight = STAGE_HEIGHT + WING_TOP + WING_BOTTOM;

      const scale = Math.min(availableW / totalWidth, availableH / totalHeight);

      const x = (canvasSize.w - STAGE_WIDTH * scale) / 2;
      const y = (canvasSize.h - STAGE_HEIGHT * scale) / 2 + (WING_TOP - WING_BOTTOM) * scale / 2;

      setTransform({ x, y, k: scale });
      onZoomChange?.(scale);
  };

  // --- 4. 外部公開メソッド ---
  useImperativeHandle(ref, () => ({
    getCanvasStream: () => {
        if (recordingCanvasRef.current) {
            return recordingCanvasRef.current.captureStream(30);
        }
        throw new Error("Recording Canvas not initialized");
    },
    resetView: () => {
        fitStageToCanvas();
    }
  }));

  // --- ヘルパー ---
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

  const clampPosition = (x: number, y: number) => ({
      x: Math.max(-WINGS_WIDTH + 20, Math.min(STAGE_WIDTH + WINGS_WIDTH - 20, x)),
      y: Math.max(-WING_TOP + 20, Math.min(STAGE_HEIGHT + WING_BOTTOM - 20, y))
  });

  // --- 描画ロジック ---
  const drawScene = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      currentTransform: { x: number, y: number, k: number },
      isForRecording: boolean = false
  ) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.setTransform(currentTransform.k, 0, 0, currentTransform.k, currentTransform.x, currentTransform.y);

    // Wings (左右)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-WINGS_WIDTH, -WING_TOP, WINGS_WIDTH, WING_TOP + STAGE_HEIGHT + WING_BOTTOM);
    ctx.fillRect(STAGE_WIDTH, -WING_TOP, WINGS_WIDTH, WING_TOP + STAGE_HEIGHT + WING_BOTTOM);

    // Wings (上下)
    ctx.fillRect(0, -WING_TOP, STAGE_WIDTH, WING_TOP);
    ctx.fillRect(0, STAGE_HEIGHT, STAGE_WIDTH, WING_BOTTOM);

    // Stage
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // Border
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2 / currentTransform.k;
    ctx.strokeRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const centerX = STAGE_WIDTH / 2;
    const centerY = STAGE_HEIGHT / 2;

    // Grid
    if (gridSize > 0) {
        const drawGridLines = (start: number, end: number, step: number, isVertical: boolean, isWing: boolean) => {
             ctx.strokeStyle = isWing ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.5)';
             ctx.lineWidth = 1 / currentTransform.k;
             const offset = isVertical ? centerX % step : centerY % step;
             const firstLine = Math.floor((start - offset) / step) * step + offset;

             ctx.beginPath();
             for (let val = firstLine; val <= end; val += step) {
                 if (isVertical) {
                     ctx.moveTo(val, -WING_TOP);
                     ctx.lineTo(val, STAGE_HEIGHT + WING_BOTTOM);
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
        drawGridLines(-WING_TOP, 0, gridSize, false, true);
        drawGridLines(STAGE_HEIGHT, STAGE_HEIGHT + WING_BOTTOM, gridSize, false, true);
        drawGridLines(0, STAGE_HEIGHT, gridSize, false, false);
    }

    // Center Cross
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3 / currentTransform.k;
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
      let pos = positions[dancer.id] || { x: 0, y: 0 };

      // Override if multi-dragging
      if (multiDragStateRef.current && multiDragStateRef.current.dragging && multiDragStateRef.current.currentOffsets[dancer.id]) {
          pos = multiDragStateRef.current.currentOffsets[dancer.id];
      }

      const isSelected = !isForRecording && selectedDancerIds.has(dancer.id);
      const isDragging = !isForRecording && isDraggingDancers && selectedDancerIds.has(dancer.id);

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
        ctx.lineWidth = 2 / currentTransform.k;
        ctx.stroke();
      }

      // Body
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = dancer.color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = (isSelected ? 3 : 1) / currentTransform.k;
      ctx.stroke();

      // Initial
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `bold 12px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dancer.name.substring(0, 1).toUpperCase(), pos.x, pos.y);

      // Full Name
      const screenFontSize = 14;
      const worldFontSize = Math.max(1, screenFontSize / currentTransform.k);
      ctx.font = `bold ${worldFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelY = pos.y + 20;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 3 / currentTransform.k;
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
    ctx.fillText("BACK", STAGE_WIDTH / 2, -WING_TOP / 2);
    ctx.fillText("FRONT", STAGE_WIDTH / 2, STAGE_HEIGHT + WING_BOTTOM / 2);

    // Selection Box (矩形選択)
    if (!isForRecording && selectionBoxRef.current && selectionBoxRef.current.active) {
        const sb = selectionBoxRef.current;
        // Convert screen coords to world coords for drawing
        const start = screenToWorld(sb.startScreen.x, sb.startScreen.y);
        const end = screenToWorld(sb.currentScreen.x, sb.currentScreen.y);
        const bx = Math.min(start.x, end.x);
        const by = Math.min(start.y, end.y);
        const bw = Math.abs(end.x - start.x);
        const bh = Math.abs(end.y - start.y);

        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 1.5 / currentTransform.k;
        ctx.setLineDash([6 / currentTransform.k, 4 / currentTransform.k]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
    }
  };

  // --- 5. 描画ループ ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false,
            preserveDrawingBuffer: true
        });

        if (ctx) {
            drawScene(ctx, canvas.width, canvas.height, transform);
        }
    }

    const recCanvas = recordingCanvasRef.current;
    if (recCanvas) {
        const recCtx = recCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false,
            preserveDrawingBuffer: true
        });

        if (recCtx) {
            const fixedTransform = {
                x: WINGS_WIDTH * REC_SCALE,
                y: WING_TOP * REC_SCALE,
                k: REC_SCALE
            };
            drawScene(recCtx, recCanvas.width, recCanvas.height, fixedTransform, true);
        }
    }

  }, [dancers, positions, isDraggingDancers, isRecording, selectedDancerIds, gridSize, transform, canvasSize]);

  // --- 6. イベントハンドラ ---

  const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (isDraggingDancers) return;
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
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointersRef.current.set(e.pointerId, { x: sx, y: sy });

    if (pointersRef.current.size === 1) {
        const { x: wx, y: wy } = screenToWorld(sx, sy);
        const isShift = e.shiftKey || e.metaKey || e.ctrlKey;

        // Hit test
        let hitId: string | null = null;
        for (let i = dancers.length - 1; i >= 0; i--) {
            const d = dancers[i];
            const p = positions[d.id];
            if (p) {
                const dist = Math.sqrt((wx - p.x) ** 2 + (wy - p.y) ** 2);
                if (dist <= 35) {
                    hitId = d.id;
                    break;
                }
            }
        }

        if (hitId) {
            isDraggingViewRef.current = false;

            if (isShift) {
                // Shift+click: toggle selection
                const next = new Set(selectedDancerIds);
                if (next.has(hitId)) {
                    next.delete(hitId);
                } else {
                    next.add(hitId);
                }
                onSelectDancers(next);
            } else {
                // Normal click on dancer
                if (!selectedDancerIds.has(hitId)) {
                    // Click unselected dancer: select only this one
                    onSelectDancers(new Set([hitId]));
                }
                // If already selected, keep current selection (for multi-drag)
            }

            // Start multi-drag for all selected dancers (or the just-clicked one)
            const dragIds = selectedDancerIds.has(hitId) ? selectedDancerIds : new Set([hitId]);
            const startPositions: Record<string, Position> = {};
            dragIds.forEach(id => {
                startPositions[id] = positions[id] || { x: 0, y: 0 };
            });

            multiDragStateRef.current = {
                dragging: true,
                anchorWorld: { x: wx, y: wy },
                startPositions,
                currentOffsets: { ...startPositions }
            };
            setIsDraggingDancers(true);
        } else {
            // Clicked empty space
            const isTouch = e.pointerType === 'touch';
            // PC: Shift+ドラッグで矩形選択、通常ドラッグでパン
            // タッチ: 1本指ドラッグで矩形選択、2本指でパン（2本指はmulti-touchブロックで処理）
            const shouldStartSelectionBox = isTouch || isShift;

            if (!isShift) {
                onSelectDancers(new Set());
            }

            if (shouldStartSelectionBox) {
                // Start rectangle selection mode
                selectionBoxRef.current = {
                    active: false,
                    startScreen: { x: sx, y: sy },
                    currentScreen: { x: sx, y: sy }
                };
                isDraggingViewRef.current = false;
            } else {
                // Start view pan
                selectionBoxRef.current = null;
                isDraggingViewRef.current = true;
                prevPanPointRef.current = { x: e.clientX, y: e.clientY };
            }
        }
    } else {
        // Multi-touch: cancel dancer drag, switch to pinch/pan
        multiDragStateRef.current = null;
        setIsDraggingDancers(false);
        selectionBoxRef.current = null;
        isDraggingViewRef.current = true;
        if (pointersRef.current.size === 2) {
            const values = Array.from(pointersRef.current.values());
            const p1 = values[0] as { x: number, y: number };
            const p2 = values[1] as { x: number, y: number };
            const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
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

    // Multi-dancer drag
    if (multiDragStateRef.current && multiDragStateRef.current.dragging && pointersRef.current.size === 1) {
        const { x: wx, y: wy } = screenToWorld(currentX, currentY);
        const anchor = multiDragStateRef.current.anchorWorld;
        let dx = wx - anchor.x;
        let dy = wy - anchor.y;

        if (snapToGrid && gridSize > 1) {
            dx = Math.round(dx / gridSize) * gridSize;
            dy = Math.round(dy / gridSize) * gridSize;
        }

        const newOffsets: Record<string, Position> = {};
        for (const [id, startPos] of Object.entries(multiDragStateRef.current.startPositions)) {
            const clamped = clampPosition(startPos.x + dx, startPos.y + dy);
            newOffsets[id] = clamped;
        }
        multiDragStateRef.current.currentOffsets = newOffsets;

        // Force manual redraw
        const canvas = canvasRef.current;
        if (canvas) {
             const ctx = canvas.getContext('2d', {
                alpha: true,
                willReadFrequently: false,
                preserveDrawingBuffer: true
            });
            if (ctx) {
                drawScene(ctx, canvas.width, canvas.height, transform);
            }
        }
        return;
    }

    // Rectangle selection (separate from pan)
    if (selectionBoxRef.current && pointersRef.current.size === 1) {
        const sb = selectionBoxRef.current;
        const dsx = currentX - sb.startScreen.x;
        const dsy = currentY - sb.startScreen.y;
        const dist = Math.sqrt(dsx * dsx + dsy * dsy);

        if (dist > 5) {
            sb.active = true;
        }
        if (sb.active) {
            sb.currentScreen = { x: currentX, y: currentY };

            // Force manual redraw to show selection box
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d', {
                    alpha: true,
                    willReadFrequently: false,
                    preserveDrawingBuffer: true
                });
                if (ctx) {
                    drawScene(ctx, canvas.width, canvas.height, transform);
                }
            }
        }
        return;
    }

    // View pan/pinch
    if (isDraggingViewRef.current) {
        if (pointersRef.current.size === 2) {
            const values = Array.from(pointersRef.current.values());
            const p1 = values[0];
            const p2 = values[1];
            const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            if (prevPinchDistRef.current && prevPanPointRef.current) {
                const scaleFactor = dist / prevPinchDistRef.current;
                const newScale = Math.min(5, Math.max(0.1, transform.k * scaleFactor));
                const clientCenter = { x: center.x + rect.left, y: center.y + rect.top };
                const deltaX = clientCenter.x - prevPanPointRef.current.x;
                const deltaY = clientCenter.y - prevPanPointRef.current.y;
                const cwx = (center.x - transform.x) / transform.k;
                const cwy = (center.y - transform.y) / transform.k;
                const newX = center.x - cwx * newScale + deltaX;
                const newY = center.y - cwy * newScale + deltaY;
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
        // Commit multi-dancer drag
        if (multiDragStateRef.current && multiDragStateRef.current.dragging) {
            const offsets = multiDragStateRef.current.currentOffsets;
            const startPositions = multiDragStateRef.current.startPositions;

            // Check if anything actually moved
            let moved = false;
            for (const id of Object.keys(offsets)) {
                if (offsets[id].x !== startPositions[id].x || offsets[id].y !== startPositions[id].y) {
                    moved = true;
                    break;
                }
            }

            if (moved) {
                if (Object.keys(offsets).length === 1) {
                    const id = Object.keys(offsets)[0];
                    onPositionChange(id, offsets[id]);
                } else {
                    onMultiPositionChange(offsets);
                }
            }
        }

        // Commit rectangle selection
        if (selectionBoxRef.current && selectionBoxRef.current.active) {
            const sb = selectionBoxRef.current;
            const start = screenToWorld(sb.startScreen.x, sb.startScreen.y);
            const end = screenToWorld(sb.currentScreen.x, sb.currentScreen.y);
            const minX = Math.min(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxX = Math.max(start.x, end.x);
            const maxY = Math.max(start.y, end.y);

            const isShift = e.shiftKey || e.metaKey || e.ctrlKey;
            const newSelection = isShift ? new Set(selectedDancerIds) : new Set<string>();

            dancers.forEach(d => {
                const p = positions[d.id];
                if (p && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
                    newSelection.add(d.id);
                }
            });

            onSelectDancers(newSelection);
        }

        multiDragStateRef.current = null;
        setIsDraggingDancers(false);
        selectionBoxRef.current = null;
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
      {/* Recording Canvas (Hidden) */}
      <canvas
        ref={recordingCanvasRef}
        width={(STAGE_WIDTH + WINGS_WIDTH * 2) * REC_SCALE}
        height={(STAGE_HEIGHT + WING_TOP + WING_BOTTOM) * REC_SCALE}
        className="hidden"
      />
    </div>
  );
});

export default Stage;
