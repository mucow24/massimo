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
 * orientation. Returns a unit vector along ±x or ±y.
 *
 * For explicit orientations (`up`/`down`/`left`/`right`) the result is fixed.
 * For `auto-*` orientations the sign comes from `lineHintLocal` — the line's
 * actual local-frame direction at this station, derived from the world
 * tangent rotated by `-station.rotation`. If no hint is supplied (e.g.
 * orphan stops with no line connected), auto falls back to +axis (down/right)
 * to match the legacy behavior.
 */
export const travelDirLocal = (
  o: StopOrientation,
  lineHintLocal: Vec2 | null = null,
): Vec2 => {
  switch (o) {
    case 'down':
      return { x: 0, y: 1 };
    case 'up':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 1, y: 0 };
    case 'left':
      return { x: -1, y: 0 };
    case 'auto-vertical':
      return { x: 0, y: lineHintLocal && lineHintLocal.y < 0 ? -1 : 1 };
    case 'auto-horizontal':
      return { x: lineHintLocal && lineHintLocal.x < 0 ? -1 : 1, y: 0 };
  }
};

/** Whether a stop's orientation runs along the local Y axis (vertical). */
export const isVerticalAxis = (o: StopOrientation): boolean =>
  o === 'up' || o === 'down' || o === 'auto-vertical';

/**
 * Half-edge offset from a stop center to its input edge midpoint, in local
 * coords. The input edge is the one OPPOSITE the resolved travel direction,
 * so it depends on the resolved direction (±axis) — `lineHintLocal` is
 * forwarded through to `travelDirLocal`.
 */
export const inputEdgeOffsetLocal = (
  o: StopOrientation,
  lineHintLocal: Vec2 | null = null,
): Vec2 => {
  const d = travelDirLocal(o, lineHintLocal);
  return { x: -d.x * HALF, y: -d.y * HALF };
};

/** Mirror of input: output edge midpoint offset. */
export const outputEdgeOffsetLocal = (
  o: StopOrientation,
  lineHintLocal: Vec2 | null = null,
): Vec2 => {
  const d = travelDirLocal(o, lineHintLocal);
  return { x: d.x * HALF, y: d.y * HALF };
};

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
  // World-frame direction of travel from `from` toward `to`. Used to resolve
  // `auto-*` orientations — pass null if you genuinely don't know (auto will
  // fall back to its +axis default).
  worldTravelDir: Vec2 | null = null,
): SegmentEndpoints => {
  const fromHintLocal = worldTravelDir
    ? rotateBy(worldTravelDir, ((-from.rotation + 8) % 8) as Rotation)
    : null;
  const toHintLocal = worldTravelDir
    ? rotateBy(worldTravelDir, ((-to.rotation + 8) % 8) as Rotation)
    : null;
  const start = localToWorld(fromLocalPoint, from);
  const startDir = localDirToWorld(travelDirLocal(fromOrientation, fromHintLocal), from.rotation);
  const end = localToWorld(toLocalPoint, to);
  const endDir = localDirToWorld(travelDirLocal(toOrientation, toHintLocal), to.rotation);
  return { start, startDir, end, endDir };
};
