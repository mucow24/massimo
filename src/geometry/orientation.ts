import { Vec2, SQRT2_2 } from './vec';
import { wrapAngleToPi } from './lineCircle';
import type { StopOrientation } from '../model/types';

export const STOP_SIZE = 14;
export const STOP_GAP = 0;
// Historically STOP_SIZE * 0.28 = 3.92; pinned to 4 so the default dot
// DIAMETER (DOT_SIZE_DEFAULT = 2 × this) is a clean integer reachable from
// the step-1 dot-size slider. ~2% visual growth, accepted.
export const STOP_DOT_RADIUS = 4;

/**
 * Half-extent of the world footprint a FREE transfer anchor reserves — content
 * bounds (`transferAnchorAABB`) and the marquee hit test
 * (`transferAnchorsForRect`) both measure it from here, so an anchor can't be
 * framed by one rule and grabbed by another.
 *
 * Half a lattice cell, matching the box a hosted anchor cell (and the label
 * cell) gets in the station silhouette, so a free anchor occupies the same
 * one-cell square wherever it is reasoned about. This is deliberately NOT the
 * painted disc: `AnchorLayer` draws that at `ANCHOR_SIZE` = 10.5 (radius 5.25),
 * SMALLER than this box — the mark reads as scaffolding rather than competing
 * with the stop dots, while the footprint stays a full cell so a near-miss
 * still frames and still grabs.
 */
export const ANCHOR_HALF = STOP_SIZE / 2;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const HALF = STOP_SIZE / 2;

export const rotRad = (r: Rotation) => (r * Math.PI) / 4;

// Normalize -0 to +0. Same reason as `rotateGridDelta` below: -0 stringifies as
// "0" but loses every Object.is / toBe / toEqual comparison against 0.
const nz = (n: number): number => (n === 0 ? 0 : n);

/**
 * Rotate a point by a Rotation step (r × 45°) — same clockwise, y-down frame as
 * `vec.rotate`, but evaluated from the EXACT matrix entries (0, ±1, ±√2/2)
 * instead of `rotate(p, rotRad(r))`.
 *
 * The trig form is not accurate enough for what rides on this: `Math.cos(π/2)`
 * is 6.1e-17, not 0, so a quarter turn of an integer vector comes back as
 * (1, 6.1e-17) and a half turn as (0.9999999999999999, 1.2e-16). Every station's
 * geometry is rotated through here — `localToWorld` for each stop's world
 * position, `worldDirToLocal` for the cell under a drag cursor, `nudgeTarget`
 * for the screen direction of a candidate slot — and the drift crossed into the
 * DOCUMENT when a lattice offset rotated through it was added to a stop's cell
 * and committed. Cells are compared with `CELL_EPS` almost everywhere, so that
 * hides — until something reads them exactly (the layout editor's
 * `data-cell-row` attributes stringify the raw number; `a.row - b.row || …`
 * sort ladders never reach their tie-break) or a human opens the file.
 *
 * At the quarter turns this is a signed axis swap, so an integer input stays
 * exactly integer. At the eighth turns every component is an exact integer
 * multiple of √2/2 — the same values `latticeOffsets('diagonal', …)` generates.
 */
export const rotateBy = (p: Vec2, r: Rotation): Vec2 => {
  const { x, y } = p;
  const s = SQRT2_2;
  switch (r) {
    case 0:
      return { x: nz(x), y: nz(y) };
    case 1:
      return { x: nz((x - y) * s), y: nz((x + y) * s) };
    case 2:
      return { x: nz(-y), y: nz(x) };
    case 3:
      return { x: nz(-(x + y) * s), y: nz((x - y) * s) };
    case 4:
      return { x: nz(-x), y: nz(-y) };
    case 5:
      return { x: nz((y - x) * s), y: nz(-(x + y) * s) };
    case 6:
      return { x: nz(y), y: nz(-x) };
    case 7:
      return { x: nz((x + y) * s), y: nz((y - x) * s) };
  }
};

/**
 * Local-space center of a grid cell at (row, col). Cells touch (no gap), so
 * stop k=col=0,row=0 sits at the local origin. Position scales by STOP_SIZE.
 */
export const stopCenterAt = (row: number, col: number): Vec2 => ({
  x: col * (STOP_SIZE + STOP_GAP),
  y: row * (STOP_SIZE + STOP_GAP),
});

// Center-to-center distance at which two stripes of the given widths sit
// PACKED: exactly tangent (edges touching, no overlap) plus the pair's
// interline gap — the LARGER of the two lines' requested gaps (max-of-pair;
// pass 0/0 for plain tangency). At zero gaps the addition is bit-exact
// (`x + 0 === x`), which is what keeps legacy docs rendering byte-identically.
// The uniform-width zero-gap special case is the historical STOP_SIZE step.
// Shared by the band merge gate, the offset recurrence below, the width/gap
// edit repack (stationPacking), stop spawn, and the StopGrid's ghost/overlap
// math (which divides by STOP_SIZE to convert into lattice units). The gap
// params are deliberately REQUIRED so no call site can silently drift back
// to plain tangency.
export const tangentGap = (wA: number, wB: number, gapA: number, gapB: number): number =>
  (wA + wB) / 2 + Math.max(gapA, gapB);

// Perp/parallel proximity tolerance (world units) for deciding two adjacent
// stripes are packed tightly enough to share one band. Slightly loose to
// absorb floating-point error in the tangency math: too tight splits valid
// interlines into separate bands, too loose merges lines that shouldn't share
// a corridor. Shared by the band merge gate (interlining) and the width-edit
// repack recognizer (stationPacking) so the two can never drift apart.
export const BAND_MERGE_TOL = 0.5;

/**
 * Label-cell adjacency gate, in CELL units: a stop counts as a label's
 * neighbor (the label snaps/aligns against it) up to the stop's PACKED
 * distance with the unit label cell — tangency (half + STOP_SIZE/2) plus the
 * line's interline gap, mirroring tangentGap with the label as a gapless
 * cell — floored at the historical 1-cell gate. Width and gap only ever
 * WIDEN adjacency (a width-28 stop tangent to the label sits 1.5 cells away
 * and must still snap; the ghost lattice parks a label against a gapped line
 * at the gap-widened pitch); the gate must never shrink below a park the
 * lattice offers, or the very slot the editor drops the label on renders
 * detached. Spacing edits keep old parks recognizable the other way around:
 * the width/gap label carry (stationPacking) re-parks attached labels at the
 * new pitch. The BAND_MERGE_TOL slack recognizes parks recorded under a
 * slightly wider spacing (the same 0.5-world tolerance the band machinery
 * uses); the epsilon keeps exact-tangent diagonal-grid neighbors (±√2/2 per
 * axis) in. Shared by the renderer's label snap/autoAlign (labelLayout) and
 * the spacing-edit label carry (stationPacking) so the two can never drift
 * apart.
 */
export const labelAdjacencyGate = (half: number, gap: number): number =>
  (Math.max(half, STOP_SIZE / 2) + STOP_SIZE / 2 + Math.max(gap, 0) + BAND_MERGE_TOL) / STOP_SIZE +
  1e-4;

/**
 * Perpendicular offsets for n packed stripes of the given widths and
 * per-line interline gaps (parallel arrays), in world units, relative to the
 * band centerline. Packed positions: p_0 = 0;
 * p_k = p_{k-1} + tangentGap(w_{k-1}, w_k, g_{k-1}, g_k) — each consecutive
 * pair sits at tangency plus the larger of the two gaps. The run is then
 * mean-centered (offset_k = p_k − mean(p)) so it straddles the band's
 * centerline exactly as the stop cells straddle their centroid — the band
 * centerline IS the centroid of the stop positions (the mean), so mean-centered
 * offsets land each stripe precisely on its stop.
 *
 * Uniform widths at zero gaps reduce BIT-EXACTLY to the historical
 * `(k − (n−1)/2) · width` — for w = 14 every intermediate (prefix sums,
 * their mean) is exactly representable, which is what keeps legacy
 * all-default docs rendering byte-identically (a zero gap adds a literal
 * `+ 0`, exact in IEEE arithmetic).
 *
 * These offsets MUST agree across band paint, outline, label placement, and
 * the hit/drag paths or the rendered geometry desyncs — so they are computed
 * once (in buildBandSpec) and baked onto SegmentBandSpec.stripeOffsets for
 * every consumer to read.
 */
export function stripeOffsetsForWidths(
  widths: readonly number[],
  gaps: readonly number[],
): number[] {
  const n = widths.length;
  if (n === 0) return [];
  const p: number[] = [0];
  for (let k = 1; k < n; k++)
    p.push(p[k - 1] + tangentGap(widths[k - 1], widths[k], gaps[k - 1], gaps[k]));
  const mean = p.reduce((a, b) => a + b, 0) / n;
  return p.map((x) => x - mean);
}

/**
 * Clockwise rotation (degrees) that puts a vertical double-headed arrow onto a
 * stop's axis — the second encoding of the same four axes `travelDirLocal`
 * resolves below, and it has to agree with it up to sign (a rotation carries no
 * direction along the axis). `orientation.test.ts` pins that agreement: the two
 * tables sitting side by side is the point, since a stop's stripe follows
 * `travelDirLocal` while the arrow drawn on it follows this.
 *
 * Both surfaces that draw the arrow — the layout editor's grab rings and the
 * map's hover badges — DRAW it (`orientationArrowPath`) rather than typesetting
 * ↕ ⤢ ↔ ⤡: fonts draw the diagonal pair corner-to-corner of a tall em box
 * (~33.8° off vertical in the shipped stack, not 45°), which read as visibly
 * crooked vertical and horizontal arrows inside a rotated station frame. Drawn
 * geometry is exact on every axis, and both surfaces render inside the
 * station-rotated frame, so the arrow always reads world-true.
 */
export const ORIENTATION_ANGLE: Record<StopOrientation, number> = {
  'auto-vertical': 0,
  'auto-ne-sw': 45,
  'auto-horizontal': 90,
  'auto-nw-se': 135,
};

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

/**
 * The angle (radians, clockwise in the y-down frame) that carries a station's
 * unrotated local axes into the world. This is the frame every STOP cell is
 * resolved through — {@link stationCellToWorld}.
 *
 * An unbound station's frame is exactly its octant `rotation`, and this returns
 * that. A CIRCLE-BOUND station's is not, and that difference is the whole point
 * of this function: its lattice has to carry the ring's lanes, and those are
 * RADIAL — continuous — while `rotation` is quantized to the nearest octant, up
 * to 22.5° away. Resolve cells through the quantized angle and a lane-k stop
 * lands at R + k·pitch·cos(err) rather than R + k·pitch, so the SAME lane sits
 * on a different radius at every angle around the ring. Both concentric-arc
 * gates compare those radii against BAND_MERGE_TOL (`segCircleFit` to decide the
 * edge arcs at all, `forEachPackedRun` to decide two lanes are one band), so an
 * ordinary two-line interline fails to route, or silently stops interlining,
 * depending on where its stations happen to sit. Lane 0 is immune — zero offset,
 * nothing to quantize — which is why a single-line ring always worked and hid
 * this.
 *
 * So a bound station's frame is the RING's: the multiple-of-90° turn of the
 * radial frame lying nearest the station's octant rotation. Nearest, rather than
 * "the radial one", because which local axis points radially out depends on the
 * seat (the label-uprightness flip in `circleSeat` alone inverts it) and the
 * frame must stay the one `rotation` already names — exact instead of rounded.
 * Lane k then lands at exactly R + k·pitch at every angle.
 *
 * At the eight octant angles the ring frame IS `rotation · 45°`, and the
 * bit-exact `rotateBy` path is taken there, so a ring built on the axes — and
 * everything off a ring — stays byte-identical.
 */
export function stationFrameRad(
  station: { x: number; y: number; rotation: Rotation },
  circle: { x: number; y: number } | null,
): number {
  const octant = rotRad(station.rotation);
  if (!circle) return octant;
  const dx = station.x - circle.x;
  const dy = station.y - circle.y;
  // A station AT the center has no radial direction; fall back to the octant
  // (the same degenerate reading `circleAngleAt` takes).
  if (dx === 0 && dy === 0) return octant;
  const radial = Math.atan2(dy, dx);
  let best = radial;
  let bestOff = Infinity;
  for (let k = 0; k < 4; k++) {
    const cand = radial + (k * Math.PI) / 2;
    // Wrapped, so the comparison is true angular distance and not a winding
    // count — the candidates run to 270° past a radial that can be negative.
    const d = Math.abs(wrapAngleToPi(cand - octant));
    if (d < bestOff) {
      bestOff = d;
      best = cand;
    }
  }
  return best;
}

/**
 * The station frame in DEGREES — the form every station-local `<g>` writes into
 * its `rotate(...)`. One owner, because the failure mode of doing the
 * conversion inline is a surface that half-adopts the frame: `station.rotation *
 * 45` reads like the same number and is right for seven stations out of eight,
 * so a lattice painted through it drifts only on the ring seats between octants
 * — exactly where nobody is looking.
 */
export const stationFrameDeg = (
  station: { x: number; y: number; rotation: Rotation },
  circle: { x: number; y: number } | null,
): number => (stationFrameRad(station, circle) * 180) / Math.PI;

/**
 * Which quarter-turn of a bound station's local frame points radially OUT,
 * as 0..3 (0 = local +x is outward, 1 = +y, 2 = −x, 3 = −y). This is what a
 * stop cell's radial MEANING rests on: `col: 1` is a lane outside the ring at
 * turn 0 and a lane inside it at turn 2.
 *
 * It is not constant around a ring. `circleSeat` picks the tangent octant OR
 * its opposite, whichever leaves the label right-side-up, so `rotation` turns
 * a full 180° at the uprightness boundaries — and the frame, which tracks
 * `rotation`, turns with it. Only those two readings are reachable (the frame
 * is always the tangent or the tangent reversed, and radial is a quarter turn
 * off either), so the value only ever flips between one pair of opposites;
 * a seat can never leave a layout a quarter-turn out.
 */
export function radialLocalTurn(
  station: { x: number; y: number; rotation: Rotation },
  circle: { x: number; y: number },
): number {
  const radial = Math.atan2(station.y - circle.y, station.x - circle.x);
  const d = wrapAngleToPi(radial - stationFrameRad(station, circle));
  return ((Math.round(d / (Math.PI / 2)) % 4) + 4) % 4;
}

/**
 * A station-local point in WORLD coords, resolved through the station's frame
 * (see {@link stationFrameRad}) rather than its raw octant rotation. `circle` is
 * the line circle the station is bound to, or null.
 *
 * The octant case delegates to {@link localToWorld} so it keeps `rotateBy`'s
 * exact matrix entries — a station off a ring, or on one at an octant angle,
 * must not pick up the 6.1e-17 drift a trig rotation carries (see `rotateBy`).
 */
export const stationCellToWorld = (
  local: Vec2,
  station: { x: number; y: number; rotation: Rotation },
  circle: { x: number; y: number } | null,
): Vec2 => {
  const r = stationDirToWorld(local, station, circle);
  return { x: r.x + station.x, y: r.y + station.y };
};

/**
 * A station-local DIRECTION (or offset) rotated into world, through the
 * station's frame — {@link stationCellToWorld} without the translation. What a
 * consumer wants when it needs which WAY a local axis points rather than where
 * a cell lands (the dash tick's outward axis, for one).
 *
 * The octant case delegates to `rotateBy` so it keeps that function's exact
 * matrix entries — a station off a ring, or on one at an octant angle, must not
 * pick up the 6.1e-17 drift a trig rotation carries (see `rotateBy`).
 */
export const stationDirToWorld = (
  local: Vec2,
  station: { rotation: Rotation; x: number; y: number },
  circle: { x: number; y: number } | null,
): Vec2 => {
  // Off a ring there is nothing to resolve, and this is the hot path — every
  // stop of every station, rebuilt per drag frame. Take it before any trig.
  if (!circle) return rotateBy(local, station.rotation);
  const a = stationFrameRad(station, circle);
  if (Math.abs(wrapAngleToPi(a - rotRad(station.rotation))) < 1e-12) {
    return rotateBy(local, station.rotation);
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: local.x * c - local.y * s, y: local.x * s + local.y * c };
};

// Rotate a world-frame direction back into a station's unrotated local frame
// (rotation only, no translation) — the inverse of `rotateBy`.
export const worldDirToLocal = (world: Vec2, rotation: Rotation): Vec2 =>
  rotateBy(world, ((8 - rotation) % 8) as Rotation);

/**
 * A WORLD direction (or offset) rotated back into a station's unrotated local
 * frame, through the station's frame — the exact inverse of
 * {@link stationDirToWorld}, and what any cursor→cell resolver wants: the frame
 * that PLACED the cells is the frame that has to read them back, or a drag over
 * a ring station's own dot resolves to a cell that dot is not in.
 *
 * The octant case delegates to `worldDirToLocal` for the same reason its twin
 * delegates to `rotateBy` — exact matrix entries, no 6.1e-17 drift.
 */
export const stationDirToLocal = (
  world: Vec2,
  station: { x: number; y: number; rotation: Rotation },
  circle: { x: number; y: number } | null,
): Vec2 => {
  if (!circle) return worldDirToLocal(world, station.rotation);
  const a = stationFrameRad(station, circle);
  if (Math.abs(wrapAngleToPi(a - rotRad(station.rotation))) < 1e-12) {
    return worldDirToLocal(world, station.rotation);
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: world.x * c + world.y * s, y: -world.x * s + world.y * c };
};
