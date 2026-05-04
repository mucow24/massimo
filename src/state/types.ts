import { Vec2 } from '../geometry/vec';

export type StationId = string;
export type LineId = string;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Station {
  id: StationId;
  name: string;
  x: number;
  y: number;
  rotation: Rotation;
  stopOrder: LineId[];
}

export interface Line {
  id: LineId;
  service: string;
  color: string;
  stations: StationId[];
  waypoints?: Record<string, Vec2[]>;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MapDoc {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  // Z-order, top-of-list (index 0) renders LAST = on top, à la Photoshop layers.
  lineOrder: LineId[];
  curveRadius: number;
  viewport: Viewport;
}
