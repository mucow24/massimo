import type { SegmentBandSpec } from './interlining';
import { sampleOffsetPath } from './lineTagGeometry';
import { stripeOffset } from './orientation';
import type { Vec2 } from './vec';

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

// Number of evenly-spaced arc-length samples per band stripe used by the
// fast point-to-polyline distance approximation. 20 samples give roughly
// 1/40-of-stripe-length granularity — sufficient for label placement
// precision, and small enough that distance queries are dominated by a
// handful of subtractions / multiplications.
const STRIPE_SAMPLES = 20;

/**
 * A precomputed table of sampled offset-path points for every (band stripe)
 * in a map. Used by {@link pickLayerLabelT} to skip the per-call
 * `closestParamOnOffsetPath` cost — instead, distance from a candidate to
 * any other-band stripe is just `min over samples of |candidate - sample|`,
 * which has no per-call allocation and runs at memory speed.
 *
 * Keys are `${bandKey}|${stripeIndex}`.
 */
export type SampledBandStripes = Map<string, Vec2[]>;

/**
 * Pre-sample every stripe in every band at {@link STRIPE_SAMPLES} + 1
 * evenly-spaced arc-length fractions. Build once per band-geometry change
 * and pass into every {@link pickLayerLabelT} call over the same band
 * set — without it the placement helper does the equivalent work inline
 * on every call, which became a real bottleneck during layer cycling on
 * busy maps.
 */
export function sampleBandStripes(bands: SegmentBandSpec[]): SampledBandStripes {
  const out: SampledBandStripes = new Map();
  for (const band of bands) {
    const n = band.lines.length;
    for (let k = 0; k < n; k++) {
      const offset = stripeOffset(k, n);
      const samples: Vec2[] = [];
      for (let i = 0; i <= STRIPE_SAMPLES; i++) {
        const t = i / STRIPE_SAMPLES;
        samples.push(sampleOffsetPath(band.centerline, band.radius, offset, t).p);
      }
      out.set(band.bandKey + '|' + k, samples);
    }
  }
  return out;
}

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
 * The required `sampledStripes` argument forces callers to think about
 * caching: in production it's built once per geometry change and reused
 * across every render's stripes. {@link pickLayerLabelTUncached} is the
 * one-off wrapper that builds the cache inline — suitable for tests and
 * any other path where allocation cost is irrelevant.
 */
export function pickLayerLabelT(
  band: SegmentBandSpec,
  stripeIndex: number,
  allBands: SegmentBandSpec[],
  sampledStripes: SampledBandStripes,
  options: LayerLabelPlacementOptions = {},
): number {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES;
  const midpointBias = options.midpointBias ?? DEFAULT_MIDPOINT_BIAS;
  const n = band.lines.length;
  const targetOffset = stripeOffset(stripeIndex, n);

  let bestT = candidates[0] ?? 0.5;
  let bestScore = -Infinity;
  for (const t of candidates) {
    const { p } = sampleOffsetPath(band.centerline, band.radius, targetOffset, t);
    const distSq = nearestOtherBandDistanceSq(p, band, allBands, sampledStripes);
    const score = Math.sqrt(distSq) - midpointBias * Math.abs(t - 0.5);
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

/**
 * Convenience wrapper around {@link pickLayerLabelT} that builds the
 * `sampledStripes` cache inline. Pays the per-call sampling cost —
 * suitable for tests, one-off invocations, or anywhere allocation cost
 * doesn't matter. Production rendering paths should build the cache once
 * (with {@link sampleBandStripes}) and call `pickLayerLabelT` directly.
 */
export function pickLayerLabelTUncached(
  band: SegmentBandSpec,
  stripeIndex: number,
  allBands: SegmentBandSpec[],
  options: LayerLabelPlacementOptions = {},
): number {
  return pickLayerLabelT(band, stripeIndex, allBands, sampleBandStripes(allBands), options);
}

// Squared minimum distance from `point` to any other-band stripe's sampled
// polyline. Squared so the inner loop is pure arithmetic — sqrt is applied
// once, at the caller, only to the winning candidate's distance.
function nearestOtherBandDistanceSq(
  point: { x: number; y: number },
  targetBand: SegmentBandSpec,
  allBands: SegmentBandSpec[],
  sampled: SampledBandStripes,
): number {
  let nearestSq = Infinity;
  for (const other of allBands) {
    if (other.bandKey === targetBand.bandKey) continue;
    const otherN = other.lines.length;
    for (let k = 0; k < otherN; k++) {
      const samples = sampled.get(other.bandKey + '|' + k);
      if (!samples) continue;
      for (const s of samples) {
        const dx = point.x - s.x;
        const dy = point.y - s.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < nearestSq) nearestSq = dSq;
      }
    }
  }
  return nearestSq;
}
