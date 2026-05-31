import { Vec2, SQRT2_2 } from './vec';
import type { StopOrientation } from '../model/types';

export const STOP_SIZE = 14;
export const STOP_GAP = 0;
export const STOP_DOT_RADIUS = STOP_SIZE * 0.28;

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
 * orientation. Returns a unit vector along one of the four 45°-spaced axes.
 *
 * Each variant pins only the axis; the sign comes from `lineHintLocal` — the
 * line's actual local-frame direction at this station, derived from the
 * world tangent rotated by `-station.rotation`. With no hint (e.g. orphan
 * stops with no line connected), each variant falls back to its +axis
 * default: `auto-vertical` → +y, `auto-horizontal` → +x, `auto-ne-sw` → NE
 * (+x, −y), `auto-nw-se` → SE (+x, +y).
 */
export const travelDirLocal = (o: StopOrientation, lineHintLocal: Vec2 | null = null): Vec2 => {
  switch (o) {
    case 'auto-vertical':
      return { x: 0, y: lineHintLocal && lineHintLocal.y < 0 ? -1 : 1 };
    case 'auto-horizontal':
      return { x: lineHintLocal && lineHintLocal.x < 0 ? -1 : 1, y: 0 };
    case 'auto-ne-sw': {
      // Axis NE↔SW (screen-y-down): NE = (+x, −y), SW = (−x, +y).
      // Along-axis sign from hint · (1, −1); default = NE.
      const s = lineHintLocal && lineHintLocal.x - lineHintLocal.y < 0 ? -1 : 1;
      return { x: s * SQRT2_2, y: -s * SQRT2_2 };
    }
    case 'auto-nw-se': {
      // Axis NW↔SE: NW = (−x, −y), SE = (+x, +y). Default = SE.
      const s = lineHintLocal && lineHintLocal.x + lineHintLocal.y < 0 ? -1 : 1;
      return { x: s * SQRT2_2, y: s * SQRT2_2 };
    }
  }
};

/**
 * Rotate a grid-frame displacement (dRow, dCol) by k 90°-steps. One step
 * matches the layout transform in `rotateStationLayoutBy90(_, +1)`:
 *   (col, row) → (-row, col), i.e. (dRow, dCol) → (dCol, -dRow).
 *
 * Used by mirror-matching mass-edits: when the inspector broadcasts a
 * moveStop / moveLabel to a matching station whose layout differs from the
 * source by a layoutOffset of k, the (dRow, dCol) delta must be rotated by k
 * steps so the world-frame edit stays consistent across the group.
 */
export const rotateGridDelta = (
  dRow: number,
  dCol: number,
  k: 0 | 1 | 2 | 3,
): { dRow: number; dCol: number } => {
  let r = dRow;
  let c = dCol;
  for (let i = 0; i < k; i++) {
    const nr = c;
    const nc = -r;
    r = nr;
    c = nc;
  }
  // Normalize -0 to +0 so callers can compare with strict equality / toEqual.
  return { dRow: r === 0 ? 0 : r, dCol: c === 0 ? 0 : c };
};

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
  { dRow: 0, dCol: 1, anchor: { x: HALF, y: 0 } }, // 0: E
  { dRow: 1, dCol: 1, anchor: { x: HALF, y: HALF } }, // 1: SE
  { dRow: 1, dCol: 0, anchor: { x: 0, y: HALF } }, // 2: S
  { dRow: 1, dCol: -1, anchor: { x: -HALF, y: HALF } }, // 3: SW
  { dRow: 0, dCol: -1, anchor: { x: -HALF, y: 0 } }, // 4: W
  { dRow: -1, dCol: -1, anchor: { x: -HALF, y: -HALF } }, // 5: NW
  { dRow: -1, dCol: 0, anchor: { x: 0, y: -HALF } }, // 6: N
  { dRow: -1, dCol: 1, anchor: { x: HALF, y: -HALF } }, // 7: NE
];

export const localToWorld = (
  local: Vec2,
  station: { x: number; y: number; rotation: Rotation },
): Vec2 => {
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
 * the colored stop-marker square (rendered on top of the band) covers the
 * area around the stop center where the bands meet.
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
