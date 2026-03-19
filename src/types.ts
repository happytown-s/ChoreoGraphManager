export interface Position {
  x: number;
  y: number;
}

export interface Dancer {
  id: string;
  name: string;
  color: string;
  groupId?: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isSolo?: boolean; // Optional: UI state managed in App or here
}

export interface Keyframe {
  id: string;
  timestamp: number; // in milliseconds
  positions: Record<string, Position>; // DancerID -> Position
  controlPoints?: Record<string, Position>; // DancerID -> ControlPoint (for Bezier to NEXT keyframe)
}

export interface AppState {
  duration: number; // Total duration in ms
  currentTime: number;
  isPlaying: boolean;
  dancers: Dancer[];
  keyframes: Keyframe[];
}

export const STAGE_WIDTH = 800;
export const STAGE_HEIGHT = 600;
export const MAX_DURATION = 60000; // 1 minute default limit for demo