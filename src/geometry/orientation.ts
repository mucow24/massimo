import { Vec2, SQRT2_2, rotate } from './vec';
import type { StopOrientation } from '../model/types';

export const STOP_SIZE = 14;
export const STOP_GAP = 0;
// Historically STOP_SIZE * 0.28 = 3.92; pinned to 4 so the default dot
// DIAMETER (DOT_SIZE_DEFAULT = 2 × this) is a clean integer reachable from
// the step-1 dot-size slider. ~2% visual growth, accepted.
export const STOP_DOT_RADIUS = 4;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const HALF = STOP_SIZE / 2;

export const rotRad = (r: Rotation) => (r * Math.PI) / 4;

// Rotate a point by a Rotation step (r × 45°). Thin wrapper over `vec.rotate`
// so the rotation matrix lives in exactly one place.
export const rotateBy = (p: Vec2, r: Rotation): Vec2 => rotate(p, rotRad(r));

/**
 * Local-space center of a grid cell at (row, col). Cells touch (no gap), so
 * stop k=col=0,row=0 sits at the local origin. Position scales by STOP_SIZE.
 */
export const stopCenterAt = (row: number, col: number): Vec2 => ({
  x: col * (STOP_SIZE + STOP_GAP),
  y: row * (STOP_SIZE + STOP_GAP),
});

// Center-to-center distance at which two stripes of the given widths are
// exactly TANGENT (edges touching, no overlap). The uniform-width special
// case is the historical STOP_SIZE step. Shared by the band merge gate, the
// offset recurrence below, and the StopGrid's ghost/overlap math (which
// divides by STOP_SIZE to convert into lattice units).
export const tangentGap = (wA: number, wB: number): number => (wA + wB) / 2;

/**
 * Perpendicular offsets for n mutually-tangent stripes of the given widths,
 * in world units, relative to the band centerline. Tangency positions:
 * p_0 = 0; p_k = p_{k-1} + tangentGap(w_{k-1}, w_k). The run is then
 * mean-centered (offset_k = p_k − mean(p)) so it straddles the band's
 * centerline exactly as the stop cells straddle their centroid — the band
 * centerline IS bandCentroid(stop positions) (the mean), so mean-centered
 * offsets land each stripe precisely on its stop.
 *
 * Uniform widths reduce BIT-EXACTLY to the historical
 * `(k − (n−1)/2) · width` — for w = 14 every intermediate (prefix sums,
 * their mean) is exactly representable, which is what keeps legacy
 * all-default docs rendering byte-identically.
 *
 * These offsets MUST agree across band paint, outline, label placement, and
 * the hit/drag paths or the rendered geometry desyncs — so they are computed
 * once (in buildBandSpec) and baked onto SegmentBandSpec.stripeOffsets for
 * every consumer to read.
 */
export function stripeOffsetsForWidths(widths: readonly number[]): number[] {
  const n = widths.length;
  if (n === 0) return [];
  const p: number[] = [0];
  for (let k = 1; k < n; k++) p.push(p[k - 1] + tangentGap(widths[k - 1], widths[k]));
  const mean = p.reduce((a, b) => a + b, 0) / n;
  return p.map((x) => x - mean);
}

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
 * Rotate a grid-frame displacement (dRow, dCol) by k 45°-steps. Two steps
 * match the layout transform in `rotateStationLayoutBy90(_, +1)`:
 *   (col, row) → (-row, col), i.e. (dRow, dCol) → (dCol, -dRow);
 * an odd k adds the half-step of `rotateStationLayoutBy45(_, +1)`, which
 * maps orthogonal deltas onto the diagonal (±√2/2) lattice and back.
 *
 * Used by mirror-matching mass-edits: when the inspector broadcasts a
 * moveStop / moveLabel to a matching station whose layout differs from the
 * source by a layoutOffset of k, the (dRow, dCol) delta must be rotated by k
 * steps so the world-frame edit stays consistent across the group. Even k
 * runs integer-exact (bit-identical to the historical 4-fold behavior, in
 * 90° strides); odd k costs a single irrational multiply at the end.
 */
export const rotateGridDelta = (
  dRow: number,
  dCol: number,
  k: Rotation,
): { dRow: number; dCol: number } => {
  let r = dRow;
  let c = dCol;
  for (let i = 0; i < k >> 1; i++) {
    const nr = c;
    const nc = -r;
    r = nr;
    c = nc;
  }
  if (k % 2 === 1) {
    const nr = (r + c) * SQRT2_2;
    const nc = (c - r) * SQRT2_2;
    r = nr;
    c = nc;
  }
  // Normalize -0 to +0 so callers can compare with strict equality / toEqual.
  return { dRow: r === 0 ? 0 : r, dCol: c === 0 ? 0 : c };
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

// Rotate a world-frame direction back into a station's unrotated local frame
// (rotation only, no translation) — the inverse of `rotateBy`.
export const worldDirToLocal = (world: Vec2, rotation: Rotation): Vec2 =>
  rotateBy(world, ((8 - rotation) % 8) as Rotation);
