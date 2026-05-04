import { Vec2 } from './vec';

export const STOP_SIZE = 14;
export const STOP_GAP = 0;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const HALF = STOP_SIZE / 2;

export const rotRad = (r: Rotation) => (r * Math.PI) / 4;

export const rotateBy = (p: Vec2, r: Rotation): Vec2 => {
  const a = rotRad(r);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/**
 * In a station's local coords (rotation=0):
 *  - The first stop's center sits at the origin.
 *  - Stop i's center sits at (i * STOP_SIZE, 0) (no gap; squares share edges).
 *  - "Input" edge of a stop is its top edge; "output" is bottom.
 *  - Station name is rendered to the LEFT of stop 0.
 */
export const stopCenterLocal = (stopIndex: number): Vec2 => ({
  x: stopIndex * (STOP_SIZE + STOP_GAP),
  y: 0,
});

export const stopInputMidLocal = (stopIndex: number): Vec2 => ({
  x: stopIndex * (STOP_SIZE + STOP_GAP),
  y: -HALF,
});

export const stopOutputMidLocal = (stopIndex: number): Vec2 => ({
  x: stopIndex * (STOP_SIZE + STOP_GAP),
  y: HALF,
});

export const inputDirLocal: Vec2 = { x: 0, y: 1 }; // line travels INTO stop, going DOWN-WARD in local
export const outputDirLocal: Vec2 = { x: 0, y: 1 }; // line LEAVES stop, going DOWN-WARD in local

/**
 * Converts a local point into world coords given the station's world position
 * and rotation steps.
 */
export const localToWorld = (local: Vec2, station: { x: number; y: number; rotation: Rotation }): Vec2 => {
  const r = rotateBy(local, station.rotation);
  return { x: r.x + station.x, y: r.y + station.y };
};

export const localDirToWorld = (local: Vec2, rotation: Rotation): Vec2 => rotateBy(local, rotation);

/**
 * For a line segment FROM `fromStation` (output edge of its stop) TO `toStation` (input edge):
 * returns the world points and unit direction vectors at both ends.
 */
export interface SegmentEndpoints {
  start: Vec2;
  startDir: Vec2; // unit, points away from start (direction the line LEAVES the stop)
  end: Vec2;
  endDir: Vec2; // unit, points INTO end (direction the line ARRIVES at the stop)
}

export const segmentEndpoints = (
  from: { x: number; y: number; rotation: Rotation },
  fromStopIndex: number,
  to: { x: number; y: number; rotation: Rotation },
  toStopIndex: number,
): SegmentEndpoints => {
  // Endpoints sit at the stop edge midpoints (output edge of from-stop, input
  // edge of to-stop). The band is rendered with stroke-linecap="square" so the
  // stroke extends an extra STOP_SIZE/2 past these endpoints INTO the stop —
  // that masks any anti-aliasing hairline at the seam with the stop's colored
  // square. Routing geometry stays exactly as before.
  const start = localToWorld(stopOutputMidLocal(fromStopIndex), from);
  const startDir = localDirToWorld({ x: 0, y: 1 }, from.rotation);
  const end = localToWorld(stopInputMidLocal(toStopIndex), to);
  const endDir = localDirToWorld({ x: 0, y: 1 }, to.rotation);
  return { start, startDir, end, endDir };
};
