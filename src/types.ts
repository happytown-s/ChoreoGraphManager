export interface Position {
  x: number;
  y: number;
}

export interface Dancer {
  id: string;
  name: string;
  color: string;
}

export interface Keyframe {
  id: string;
  timestamp: number; // in milliseconds
  positions: Record<string, Position>; // DancerID -> Position
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