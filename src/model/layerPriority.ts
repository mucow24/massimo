import type { Line, StationId } from './types';
import { incidentEdges } from './lineTopology';

/**
 * Priority weight per layer step. Must exceed the largest plausible
 * `lineIndex` so a +1 layer always beats any reordering within layer 0.
 */
export const LAYER_WEIGHT = 10000;

/**
 * Effective per-segment z-layer override on `line` at `pairKey`. Missing ⇒ 0
 * (the default, never persisted) — one named home for the field default,
 * shared by the priority math and the layer-number overlay.
 */
export function resolveSegmentLayer(line: Line | undefined, pairKey: string): number {
  return line?.segmentLayers?.[pairKey] ?? 0;
}

/**
 * Compose a stripe's final paint priority from its global line index and
 * any per-segment layer override on this line. Smaller priority = renders
 * later = on top, matching the existing convention.
 */
export function segmentPriority(line: Line | undefined, pairKey: string, lineIdx: number): number {
  return lineIdx - resolveSegmentLayer(line, pairKey) * LAYER_WEIGHT;
}

/**
 * Layer to use for a stop marker at `stationId` on `line`. Picks the
 * front-most non-zero incident layer (MAX over them), or 0 when every
 * incident segment is at layer 0.
 *
 * Rule rationale: a layer-0 segment meeting a non-zero segment at the same
 * station should defer the dot to the layered side — the user explicitly
 * placed that segment at a non-default layer, so it "claims" the dot. Only
 * when ALL incident segments are at layer 0 (or there are no overrides at
 * all) do we leave the dot at the default 0. This also handles the
 * "wholly-negative line" regression: every incident at layer -1 keeps the
 * dot at -1 (behind any layer-0 crossing band), not at 0.
 */
export function stationLayerFor(line: Line, stationId: StationId): number {
  const layers = line.segmentLayers;
  if (!layers) return 0;
  return pickNonZeroMax(incidentLayers(line, stationId, layers)) ?? 0;
}

/**
 * Verdict for one endpoint of a band stripe — which of the two adjacent
 * segments at this station "wins" the right to enclose the stop-dot square
 * in its outline.
 *
 * - `win`  → THIS segment's layer is the {@link stationLayerFor} winner
 *            (or this is a terminus, in which case the segment is the sole
 *            owner). Layering-mode outlines extend OUTWARD past the station
 *            so the full dot square sits inside.
 * - `lose` → some other adjacency wins. Outlines retreat INWARD so the dot
 *            square sits fully outside.
 * - `tie`  → both adjacencies share a layer. Outlines cap at the station
 *            center, splitting the dot down the middle (the prior behavior
 *            for every non-terminus station).
 */
export type StripeEndpointFate = 'win' | 'lose' | 'tie';

export function stripeEndpointFate(
  line: Line,
  thisPairKey: string,
  stationId: StationId,
): StripeEndpointFate {
  const layers = line.segmentLayers ?? {};
  const thisLayer = layers[thisPairKey] ?? 0;
  const others = otherIncidentLayers(line, stationId, layers, thisPairKey);
  if (others === null) return 'win'; // terminus — sole owner
  const otherLayer = pickNonZeroMax(others) ?? 0;
  if (thisLayer === otherLayer) return 'tie';
  // Same filter-then-MAX rule as stationLayerFor.
  let winnerLayer: number;
  if (thisLayer === 0) winnerLayer = otherLayer;
  else if (otherLayer === 0) winnerLayer = thisLayer;
  else winnerLayer = Math.max(thisLayer, otherLayer);
  return winnerLayer === thisLayer ? 'win' : 'lose';
}

// ----- internals -----

/** MAX over the non-zero values; null when nothing non-zero was seen. */
function pickNonZeroMax(values: Iterable<number>): number | null {
  let max: number | null = null;
  for (const v of values) {
    if (v === 0) continue;
    max = max === null ? v : Math.max(max, v);
  }
  return max;
}

/** Walk every incident edge for `line` at `stationId` and yield its layer. */
function* incidentLayers(
  line: Line,
  stationId: StationId,
  layers: Record<string, number>,
): Iterable<number> {
  for (const edge of incidentEdges(line, stationId)) yield layers[edge] ?? 0;
}

/**
 * Layer values at every incident edge OTHER than `excludePairKey`.
 * Returns null when no other adjacency exists (i.e. terminus station).
 */
function otherIncidentLayers(
  line: Line,
  stationId: StationId,
  layers: Record<string, number>,
  excludePairKey: string,
): number[] | null {
  const out: number[] = [];
  for (const edge of incidentEdges(line, stationId)) {
    if (edge !== excludePairKey) out.push(layers[edge] ?? 0);
  }
  return out.length > 0 ? out : null;
}
