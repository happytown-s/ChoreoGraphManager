import { useCallback } from 'react';
import { Keyframe, Position, Dancer, STAGE_WIDTH, STAGE_HEIGHT, Group } from '../types';
import { HistoryAPI } from './useHistory';

export interface KeyframeEditorAPI {
  handlePositionChange: (dancerId: string, newPos: Position, currentTime: number, currentPositions: Record<string, Position>) => void;
  handleMultiPositionChange: (changes: Record<string, Position>, currentTime: number, currentPositions: Record<string, Position>) => void;
  handleAddKeyframe: (currentTime: number, currentPositions: Record<string, Position>) => void;
  handleDeleteKeyframe: (id: string) => void;
  handleUpdateKeyframeTime: (id: string, newTime: number) => void;
  handleJumpNextKeyframe: (sortedKeyframes: Keyframe[], currentTime: number) => void;
  handleJumpPrevKeyframe: (sortedKeyframes: Keyframe[], currentTime: number) => void;
  handleControlPointChange: (keyframeId: string, dancerId: string, newPos: Position) => void;
  activePaths: {
    keyframeId: string;
    dancerId: string;
    startPos: Position;
    endPos: Position;
    controlPoint: Position;
  }[];
}

/**
 * Finds or creates a keyframe near the given timestamp, merges position changes,
 * then pushes to history.
 */
function upsertKeyframe(
  keyframes: Keyframe[],
  currentTime: number,
  positionsToMerge: Record<string, Position>,
  currentPositions: Record<string, Position>,
): Keyframe[] {
  const THRESHOLD = 50;
  const existingIndex = keyframes.findIndex(k => Math.abs(k.timestamp - currentTime) < THRESHOLD);

  if (existingIndex >= 0) {
    const updated = [...keyframes];
    updated[existingIndex] = {
      ...updated[existingIndex],
      positions: { ...updated[existingIndex].positions, ...positionsToMerge },
    };
    return updated;
  }

  const newKf: Keyframe = {
    id: Date.now().toString(),
    timestamp: currentTime,
    positions: { ...currentPositions, ...positionsToMerge },
  };
  return [...keyframes, newKf].sort((a, b) => a.timestamp - b.timestamp);
}

export function useKeyframeEditor(
  dancers: Dancer[],
  keyframes: Keyframe[],
  groups: Group[],
  history: HistoryAPI,
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>,
  handleSeek: (time: number) => void,
): KeyframeEditorAPI {

  const pushH = useCallback((newKeyframes: Keyframe[], newDancers?: Dancer[], newGroups?: Group[]) => {
    history.pushState({
      dancers: newDancers ?? dancers,
      keyframes: newKeyframes,
      groups: newGroups ?? groups,
    });
  }, [history, dancers, keyframes, groups]);

  const handlePositionChange = useCallback((
    dancerId: string,
    newPos: Position,
    currentTime: number,
    currentPositions: Record<string, Position>,
  ) => {
    const newKeyframes = upsertKeyframe(keyframes, currentTime, { [dancerId]: newPos }, currentPositions);
    pushH(newKeyframes);
  }, [keyframes, pushH]);

  const handleMultiPositionChange = useCallback((
    changes: Record<string, Position>,
    currentTime: number,
    currentPositions: Record<string, Position>,
  ) => {
    const newKeyframes = upsertKeyframe(keyframes, currentTime, changes, currentPositions);
    pushH(newKeyframes);
  }, [keyframes, pushH]);

  const handleAddKeyframe = useCallback((
    currentTime: number,
    currentPositions: Record<string, Position>,
  ) => {
    if (keyframes.some(k => Math.abs(k.timestamp - currentTime) < 50)) return;
    const newKf: Keyframe = {
      id: Date.now().toString(),
      timestamp: currentTime,
      positions: { ...currentPositions },
    };
    const newKeyframes = [...keyframes, newKf].sort((a, b) => a.timestamp - b.timestamp);
    pushH(newKeyframes);
  }, [keyframes, pushH]);

  const handleDeleteKeyframe = useCallback((id: string) => {
    const kf = keyframes.find(k => k.id === id);
    if (kf && kf.timestamp === 0) return;
    const newKeyframes = keyframes.filter(k => k.id !== id);
    pushH(newKeyframes);
  }, [keyframes, pushH]);

  const handleUpdateKeyframeTime = useCallback((id: string, newTime: number) => {
    if (newTime < 0) newTime = 0;
    const kf = keyframes.find(k => k.id === id);
    if (kf && kf.timestamp === 0 && newTime !== 0) return;

    const newKeyframes = keyframes.map(k => k.id === id ? { ...k, timestamp: newTime } : k)
      .sort((a, b) => a.timestamp - b.timestamp);

    pushH(newKeyframes);
    setCurrentTime(newTime);
  }, [keyframes, pushH, setCurrentTime]);

  const handleJumpNextKeyframe = useCallback((
    sortedKeyframes: Keyframe[],
    currentTime: number,
  ) => {
    const next = sortedKeyframes.find(k => k.timestamp > currentTime + 50);
    handleSeek(next ? next.timestamp : 0);
  }, [handleSeek]);

  const handleJumpPrevKeyframe = useCallback((
    sortedKeyframes: Keyframe[],
    currentTime: number,
  ) => {
    const prevs = sortedKeyframes.filter(k => k.timestamp < currentTime - 50);
    handleSeek(prevs.length ? prevs[prevs.length - 1].timestamp : 0);
  }, [handleSeek]);

  const handleControlPointChange = useCallback((
    keyframeId: string,
    dancerId: string,
    newPos: Position,
  ) => {
    const newKeyframes = keyframes.map(kf => {
      if (kf.id !== keyframeId) return kf;
      return {
        ...kf,
        controlPoints: { ...kf.controlPoints, [dancerId]: newPos },
      };
    });
    pushH(newKeyframes);
  }, [keyframes, pushH]);

  // Compute active Bezier paths for current time
  const activePaths: KeyframeEditorAPI['activePaths'] = [];
  const sorted = [...keyframes].sort((a, b) => a.timestamp - b.timestamp);
  // This is a simplified computation — in App.tsx it was computed inline
  // We'll compute it reactively in the component instead

  return {
    handlePositionChange,
    handleMultiPositionChange,
    handleAddKeyframe,
    handleDeleteKeyframe,
    handleUpdateKeyframeTime,
    handleJumpNextKeyframe,
    handleJumpPrevKeyframe,
    handleControlPointChange,
    activePaths,
  };
}
