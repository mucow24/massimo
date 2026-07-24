import { perp, rotate, Vec2 } from './vec';
import { emitOffsetSegments, OffsetPathSegment } from './router';
import { pairKeyOf } from '../model/pairKey';
import type { Line, LineId, LineTag, StationId } from '../model/types';
import { clamp } from '../util/grid';

/**
 * Walk an offset path by arc length: return the world-frame point and the
 * unit tangent at fraction `t` ∈ [0, 1] of total length. Uses the same
 * `emitOffsetSegments` walker as the renderer, so sampled positions stay
 * glued to painted geometry even at the sub-pixel level.
 */
export function sampleOffsetPath(
  verts: Vec2[],
  R: number,
  offset: number,
  t: number,
): { p: Vec2; tangent: Vec2 } {
  const total = offsetPathLength(verts, R, offset);
  return sampleOffsetPathByArcLength(verts, R, offset, t * total);
}

/**
 * Walk an offset path by absolute arc length (world units). Clamps to
 * [0, total]. Used for tags pinned at a constant distance from a station,
 * so the tag stays put as the corridor's length changes.
 */
export function sampleOffsetPathByArcLength(
  verts: Vec2[],
  R: number,
  offset: number,
  arcLen: number,
): { p: Vec2; tangent: Vec2 } {
  const segs = emitOffsetSegments(verts, R, offset);
  const total = segs.reduce((a, s) => a + s.length, 0);
  if (total < 1e-9 || segs.length === 0) {
    return { p: verts[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  }
  const target = clamp(arcLen, 0, total);
  // Skip zero-length segments when selecting the sample segment: a degenerate
  // leading (or trailing) line — e.g. from a coincident vertex — has no
  // meaningful tangent, and sampleSegment would hand back (0, 0). Land on the
  // nearest segment with real length so the tangent stays unit-length.
  const lastReal = [...segs].reverse().find((s) => s.length >= 1e-9) ?? segs[segs.length - 1];
  let acc = 0;
  for (const s of segs) {
    if (s.length < 1e-9) continue;
    if (acc + s.length >= target - 1e-9 || s === lastReal) {
      return sampleSegment(s, (target - acc) / s.length);
    }
    acc += s.length;
  }
  return sampleSegment(lastReal, 1);
}

/**
 * Sample one OffsetPathSegment at fraction u ∈ [0, 1].
 *
 * Arc parametrization: with `inDir` = unit start tangent and `sign` = ±1
 * (rotation direction in math y-up; +1 = CCW = visually CW in y-down),
 * traversing angle ψ ∈ [0, theta] gives:
 *
 *   p(ψ) = from + r * (sin(ψ) * inDir + sign * (1 - cos(ψ)) * leftPerp(inDir))
 *   tangent(ψ) = rotate(inDir, sign * ψ)
 *
 * Verifies: p(0) = from, tangent(0) = inDir, and the chord (p(ψ) - center)
 * has length r.
 */
function sampleSegment(s: OffsetPathSegment, u: number): { p: Vec2; tangent: Vec2 } {
  if (s.kind === 'line') {
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    const L = Math.hypot(dx, dy) || 1;
    return {
      p: { x: s.from.x + dx * u, y: s.from.y + dy * u },
      tangent: { x: dx / L, y: dy / L },
    };
  }
  // Arc.
  const ψ = u * s.theta;
  const sin = Math.sin(ψ);
  const cos = Math.cos(ψ);
  // perp = vec.perp = (-y, x), the math-y-up 90° CCW perpendicular. `sign` (±1)
  // is the turn direction baked in by emitOffsetSegments. See the function
  // docstring for the full p(ψ) / tangent(ψ) parametrization this implements.
  const perpL = perp(s.inDir);
  const p: Vec2 = {
    x: s.from.x + s.r * (sin * s.inDir.x + s.sign * (1 - cos) * perpL.x),
    y: s.from.y + s.r * (sin * s.inDir.y + s.sign * (1 - cos) * perpL.y),
  };
  const α = s.sign * ψ;
  const tangent = rotate(s.inDir, α);
  return { p, tangent };
}

/**
 * Total arc length of the offset path.
 */
export function offsetPathLength(verts: Vec2[], R: number, offset: number): number {
  return emitOffsetSegments(verts, R, offset).reduce((a, s) => a + s.length, 0);
}

/**
 * Project a world point onto the offset path: returns the parameter `t`
 * ∈ [0, 1] of the closest point and the residual distance.
 *
 * Coarse sample (50 points) then ternary-search refine. Good enough for an
 * interactive drag handler.
 */
export function closestParamOnOffsetPath(
  verts: Vec2[],
  R: number,
  offset: number,
  target: Vec2,
): { t: number; dist: number } {
  const N = 50;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = sampleOffsetPath(verts, R, offset, t);
    const d = Math.hypot(s.p.x - target.x, s.p.y - target.y);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // Ternary-search refine around bestT.
  let lo = Math.max(0, bestT - 1 / N);
  let hi = Math.min(1, bestT + 1 / N);
  for (let iter = 0; iter < 24; iter++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const s1 = sampleOffsetPath(verts, R, offset, m1);
    const s2 = sampleOffsetPath(verts, R, offset, m2);
    const d1 = Math.hypot(s1.p.x - target.x, s1.p.y - target.y);
    const d2 = Math.hypot(s2.p.x - target.x, s2.p.y - target.y);
    if (d1 < d2) hi = m2;
    else lo = m1;
    if (d1 < bestD) {
      bestD = d1;
      bestT = m1;
    }
    if (d2 < bestD) {
      bestD = d2;
      bestT = m2;
    }
  }
  return { t: bestT, dist: bestD };
}

/**
 * True iff the line traverses the canonical (alphabetic) corridor in
 * forward order — i.e., it has a consecutive (from, to) edge with from < to.
 * False iff it has the reverse-order edge (to, from) somewhere instead.
 *
 * Used everywhere we need to convert between line-traversal `t` (how the
 * tag is stored) and canonical centerline `t` (how arc length is measured).
 *
 * If the line has neither edge, returns true (orphan; caller should handle
 * separately — `pruneOrphanLineTags` typically deletes such tags).
 */
export function lineTraversesForwardCanon(line: Line, from: StationId, to: StationId): boolean {
  for (let i = 0; i < line.stations.length - 1; i++) {
    const a = line.stations[i];
    const b = line.stations[i + 1];
    if (a === from && b === to) return true;
    if (a === to && b === from) return false;
  }
  return true;
}

/**
 * Convert an arc length along a tag's stripe into the stored `(anchorEnd,
 * distance)` pair. The tag anchors to whichever endpoint is NEARER at the
 * chosen position, storing its distance from that end, so it stays put as the
 * corridor grows or shrinks from the far side. The exact midpoint anchors to
 * `from`. Inverse of `arcLenFromAnchor`.
 */
export function anchorFromArcLen(
  arcLen: number,
  stripeTotal: number,
): { anchorEnd: 'from' | 'to'; distance: number } {
  const anchorEnd: 'from' | 'to' = arcLen <= stripeTotal / 2 ? 'from' : 'to';
  const distance = anchorEnd === 'from' ? arcLen : stripeTotal - arcLen;
  return { anchorEnd, distance };
}

/**
 * Convert a stored `(anchorEnd, distance)` pair back into an arc length along
 * the stripe, walking `distance` from the anchor endpoint. Clamped to
 * `[0, stripeTotal]` so a distance that overruns a shrunken corridor lands on
 * the near end rather than past it. Inverse of `anchorFromArcLen`.
 */
export function arcLenFromAnchor(
  anchorEnd: 'from' | 'to',
  distance: number,
  stripeTotal: number,
): number {
  return anchorEnd === 'from'
    ? Math.min(distance, stripeTotal)
    : Math.max(0, stripeTotal - distance);
}

/** Neighbor-tag snap tolerance, in world arc-length units at zoom 1. Callers
 *  divide by zoom so the engage radius stays constant in screen pixels —
 *  the same convention as SNAP_PERP_TOLERANCE. */
export const LINE_TAG_SNAP_TOLERANCE = 10;

/** The matched neighbor of a successful {@link snapNeighborTag}: enough to
 *  sample its world position (stripe offset + canon-t) for a snap guide. */
export interface NeighborTagMatch {
  lineId: LineId;
  canonT: number;
  stripeOffset: number;
}

/**
 * Snap-to-neighbor for line-tag drag and placement.
 *
 * Given a candidate `t` for the tag on the dragged stripe (offset
 * `candOffset`), scans every OTHER tag in the same corridor and returns the
 * NEAREST one whose CROSS-SECTION is within `tol` (world arc-length units
 * along the dragged stripe) — as the `t` on the dragged stripe that sits
 * directly across the corridor from it — plus that neighbor's identity in
 * `match` so the caller can draw a guide to it. Otherwise returns the
 * candidate unchanged.
 *
 * Alignment is by CROSS-SECTION, not by fraction-of-own-stripe: two tags are
 * "adjacent" when they sit on the same perpendicular slice of the corridor.
 * Offset stripes are concentric through a bend (same angle, radius R ± offset),
 * so equal arc-length *fractions* land at different cross-sections wherever the
 * band curves — which read as tags snapping at an along-corridor offset rather
 * than side by side. Projecting the neighbor's rendered world point onto the
 * dragged stripe (closest point between parallel/concentric offsets lies along
 * the shared normal) recovers the true cross-section on straights and curves
 * alike.
 *
 * `lineStripeOffset(lineId)` lets the caller report the perpendicular offset
 * of any line's stripe within the band — used to compute that line's stripe
 * arc length. Returns null for lines not in the band; those are skipped.
 */
export function snapNeighborTag(args: {
  candCanonT: number;
  candOffset: number;
  candPairKey: string;
  selfTagId: string;
  bandCenterline: Vec2[];
  curveRadius: number;
  lineStripeOffset: (lineId: LineId) => number | null;
  lineTags: Record<string, LineTag>;
  tol: number;
}): { canonT: number; snapped: boolean; match?: NeighborTagMatch } {
  const candStripeTotal = offsetPathLength(args.bandCenterline, args.curveRadius, args.candOffset);
  if (candStripeTotal <= 0) return { canonT: args.candCanonT, snapped: false };
  const candArcLen = args.candCanonT * candStripeTotal;
  let best: { match: NeighborTagMatch; alignedT: number; delta: number } | null = null;
  for (const otherId of Object.keys(args.lineTags)) {
    if (otherId === args.selfTagId) continue;
    const other = args.lineTags[otherId];
    const otherPairKey = pairKeyOf(other.fromStationId, other.toStationId);
    if (otherPairKey !== args.candPairKey) continue;
    const otherOffset = args.lineStripeOffset(other.lineId);
    if (otherOffset === null) continue;
    const otherStripeTotal = offsetPathLength(args.bandCenterline, args.curveRadius, otherOffset);
    if (otherStripeTotal <= 0) continue;
    const otherArcLen = arcLenFromAnchor(other.anchorEnd, other.distance, otherStripeTotal);
    // The neighbor's actual rendered position (see resolveTag), then the point
    // on the dragged stripe directly across the corridor from it.
    const otherWorld = sampleOffsetPathByArcLength(
      args.bandCenterline,
      args.curveRadius,
      otherOffset,
      otherArcLen,
    ).p;
    const alignedT = closestParamOnOffsetPath(
      args.bandCenterline,
      args.curveRadius,
      args.candOffset,
      otherWorld,
    ).t;
    const delta = Math.abs(alignedT * candStripeTotal - candArcLen);
    if (delta < args.tol && (!best || delta < best.delta)) {
      best = {
        // `match.canonT` is the neighbor's OWN t (fraction of its own stripe),
        // so the caller samples the neighbor's world point for the guide;
        // `alignedT` is where the DRAGGED tag lands (its stripe, same slice).
        match: {
          lineId: other.lineId,
          canonT: otherArcLen / otherStripeTotal,
          stripeOffset: otherOffset,
        },
        alignedT,
        delta,
      };
    }
  }
  if (best) {
    return { canonT: best.alignedT, snapped: true, match: best.match };
  }
  return { canonT: args.candCanonT, snapped: false };
}
