import { Vec2 } from './vec';
import type { StopOrientation } from '../state/types';

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
 * Local-space center of a grid cell at (row, col). Cells touch (no gap), so
 * stop k=col=0,row=0 sits at the local origin. Position scales by STOP_SIZE.
 */
export const stopCenterAt = (row: number, col: number): Vec2 => ({
  x: col * (STOP_SIZE + STOP_GAP),
  y: row * (STOP_SIZE + STOP_GAP),
});

/**
 * Travel direction in the unrotated local frame for a stop with the given
 * orientation. Vertical → +y (line moves down); horizontal → +x (right).
 * Both the "input" and "output" edges have this same travel direction.
 */
export const travelDirLocal = (o: StopOrientation): Vec2 =>
  o === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 };

/**
 * Half-edge offset from a stop center to its input edge midpoint, in local
 * coords. For vertical stops the input edge is the top (−y, hence −HALF y);
 * for horizontal stops it's the left (−x).
 */
export const inputEdgeOffsetLocal = (o: StopOrientation): Vec2 =>
  o === 'vertical' ? { x: 0, y: -HALF } : { x: -HALF, y: 0 };

/** Mirror of input: output edge midpoint offset. */
export const outputEdgeOffsetLocal = (o: StopOrientation): Vec2 =>
  o === 'vertical' ? { x: 0, y: HALF } : { x: HALF, y: 0 };

/**
 * 8-way direction for label rotation. Index = rotation 0..7. Each entry has
 * the grid cell offset (dRow, dCol) you'd step into to reach the cell that
 * lies in that direction, and the corresponding cell-boundary anchor point
 * (cell-local coords) — for cardinal rotations it's an edge midpoint, for
 * diagonals it's a corner.
 */
export const DIR_8: { dRow: number; dCol: number; anchor: Vec2 }[] = [
  { dRow: 0, dCol: 1, anchor: { x: HALF, y: 0 } },     // 0: E
  { dRow: 1, dCol: 1, anchor: { x: HALF, y: HALF } },  // 1: SE
  { dRow: 1, dCol: 0, anchor: { x: 0, y: HALF } },     // 2: S
  { dRow: 1, dCol: -1, anchor: { x: -HALF, y: HALF } },// 3: SW
  { dRow: 0, dCol: -1, anchor: { x: -HALF, y: 0 } },   // 4: W
  { dRow: -1, dCol: -1, anchor: { x: -HALF, y: -HALF } }, // 5: NW
  { dRow: -1, dCol: 0, anchor: { x: 0, y: -HALF } },   // 6: N
  { dRow: -1, dCol: 1, anchor: { x: HALF, y: -HALF } },// 7: NE
];

export const localToWorld = (local: Vec2, station: { x: number; y: number; rotation: Rotation }): Vec2 => {
  const r = rotateBy(local, station.rotation);
  return { x: r.x + station.x, y: r.y + station.y };
};

export const localDirToWorld = (local: Vec2, rotation: Rotation): Vec2 => rotateBy(local, rotation);

export interface SegmentEndpoints {
  start: Vec2;
  startDir: Vec2;
  end: Vec2;
  endDir: Vec2;
}

/**
 * Compute the world endpoints + travel directions for a band segment.
 *
 * `fromLocalPoint` / `toLocalPoint` are local-space points on each station
 * (typically the centerline anchor of the band — the mean of its endpoint
 * cells). `fromOrientation` / `toOrientation` give the band's shared
 * orientation at each station — they should match for a valid interlined
 * band, though the function tolerates per-end values for flexibility.
 *
 * The endpoints are placed at the stop center (the local point as given);
 * the renderer's stroke-linecap="square" extends the band into the stop
 * area, masking any seam at the colored square.
 */
export const segmentEndpoints = (
  from: { x: number; y: number; rotation: Rotation },
  fromLocalPoint: Vec2,
  fromOrientation: StopOrientation,
  to: { x: number; y: number; rotation: Rotation },
  toLocalPoint: Vec2,
  toOrientation: StopOrientation,
): SegmentEndpoints => {
  const start = localToWorld(fromLocalPoint, from);
  const startDir = localDirToWorld(travelDirLocal(fromOrientation), from.rotation);
  const end = localToWorld(toLocalPoint, to);
  const endDir = localDirToWorld(travelDirLocal(toOrientation), to.rotation);
  return { start, startDir, end, endDir };
};
