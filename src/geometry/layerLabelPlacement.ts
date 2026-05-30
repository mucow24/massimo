import type { SegmentBandSpec } from './interlining';
import { closestParamOnOffsetPath, sampleOffsetPath } from './lineTagGeometry';
import { STOP_SIZE } from './orientation';

// Arc-length fractions to try when placing a layer-number label on a band
// stripe. The list spans the central 60% of the stripe so labels stay clear
// of the stop dots at each end; the helper then picks the t with the most
// breathing room from any other-band stripe.
const DEFAULT_CANDIDATES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

// Per-unit-of-|t-0.5| penalty applied to each candidate's clearance score.
// Acts as a soft midpoint preference: when several candidates have similar
// clearance, the closer-to-midpoint one wins. Small enough that a genuinely
// clearer off-center spot still beats the midpoint when it matters.
const DEFAULT_MIDPOINT_BIAS = 4;

export interface LayerLabelPlacementOptions {
  /**
   * Arc-length fractions to try along the target stripe. The helper picks
   * the t with the highest clearance score; ties go to whichever candidate
   * comes first in this list (so passing `[0.5, ...]` keeps a midpoint
   * preference for genuinely-tied scores). Defaults to
   * {@link DEFAULT_CANDIDATES}.
   */
  candidates?: number[];
  /**
   * World-unit penalty per unit of `|t - 0.5|`. Higher values keep the
   * label closer to the midpoint even when off-center spots have slightly
   * more clearance. Defaults to {@link DEFAULT_MIDPOINT_BIAS}.
   */
  midpointBias?: number;
}

/**
 * Pick an arc-length fraction (`t` ∈ [0, 1]) along the target stripe at
 * which to place that stripe's layer-number label, by scoring each
 * candidate by nearest-other-band distance (minus a small midpoint bias)
 * and returning the highest-scoring candidate.
 *
 * Maximising clearance — rather than short-circuiting at the first
 * candidate that exceeds a threshold — means tangled hubs where every
 * candidate is somewhat covered still pick the LEAST-bad spot rather than
 * silently snapping back to the midpoint where the congestion is usually
 * worst.
 *
 * "Other band" means a band with a different `bandKey` — sibling stripes
 * inside the same band run parallel to the target so they can't visually
 * overlap it. Render priority is intentionally NOT consulted: even when
 * the target paints on top of a crossing, the crossing's surroundings
 * leak past the target's narrow band width, so labels in the overlap zone
 * read as ambiguous.
 *
 * Sample-to-stripe distances come from {@link closestParamOnOffsetPath},
 * which the line-tag layer already uses for drag-snap.
 */
export function pickLayerLabelT(
  band: SegmentBandSpec,
  stripeIndex: number,
  allBands: SegmentBandSpec[],
  options: LayerLabelPlacementOptions = {},
): number {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES;
  const midpointBias = options.midpointBias ?? DEFAULT_MIDPOINT_BIAS;
  const n = band.lines.length;
  const targetOffset = (stripeIndex - (n - 1) / 2) * STOP_SIZE;

  let bestT = candidates[0] ?? 0.5;
  let bestScore = -Infinity;
  for (const t of candidates) {
    const { p } = sampleOffsetPath(band.centerline, band.radius, targetOffset, t);
    const dist = nearestOtherBandDistance(p, band, allBands);
    const score = dist - midpointBias * Math.abs(t - 0.5);
    // Strict `>` so the first candidate in the list wins ties — keeps the
    // midpoint-first ordering useful even when every score is identical
    // (e.g. when there are no other bands at all).
    if (score > bestScore) {
      bestScore = score;
      bestT = t;
    }
  }
  return bestT;
}

function nearestOtherBandDistance(
  point: { x: number; y: number },
  targetBand: SegmentBandSpec,
  allBands: SegmentBandSpec[],
): number {
  let nearest = Infinity;
  for (const other of allBands) {
    if (other.bandKey === targetBand.bandKey) continue;
    const otherN = other.lines.length;
    for (let k = 0; k < otherN; k++) {
      const otherOffset = (k - (otherN - 1) / 2) * STOP_SIZE;
      const closest = closestParamOnOffsetPath(other.centerline, other.radius, otherOffset, point);
      if (closest.dist < nearest) nearest = closest.dist;
    }
  }
  return nearest;
}
