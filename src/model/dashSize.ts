import { lineWidthOf } from './lineWidth';
import { resolveDotStyle, stationIsSingleton } from './transforms';
import type { Line, StopCell } from './types';

// TfL-tick dimensions for 'dash' stops, derived from the line's stripe width
// when not explicitly set. The ratios reproduce the TfL proportions at the
// default width: a 14-wide line gets a 14-long, 7-thick tick. Because the
// derived length equals one line width, the tick of an inner interlined stop
// exactly covers a same-width neighbor stripe and lands flush on the next
// line's edge — the "notched" composite tick is emergent, no chain logic.
export const DASH_LENGTH_RATIO = 1;
export const DASH_WIDTH_RATIO = 0.5;

// Slider bounds only — the textboxes may exceed them (NumericFieldRow's
// textboxAllowAboveMax). Stored values share the casing width's canonical
// quarter-unit grid + drop-at-0 (see canonicalStrokeWidth): 0 = "auto",
// i.e. the field is dropped and the width derivation takes over.
export const DASH_LENGTH_MAX = 40;
export const DASH_WIDTH_MAX = 20;

/**
 * Stored dash length — the RAW field (undefined when unset = derive from the
 * line width at render). Structural parameter so narrowed line shapes pass
 * through (same convention as lineSeamWidthOf).
 */
export const lineDashLengthOf = (
  line: { dashLength?: number } | null | undefined,
): number | undefined => line?.dashLength;

/** Stored dash thickness — the RAW field (undefined when unset = derive). */
export const lineDashWidthOf = (
  line: { dashWidth?: number } | null | undefined,
): number | undefined => line?.dashWidth;

/**
 * Rendered tick length (protrusion from the stripe edge toward the label),
 * world units: the stored override, else the line width × DASH_LENGTH_RATIO.
 */
export const dashRenderLength = (
  line: { dashLength?: number; dashWidth?: number; width?: number } | null | undefined,
): number => lineDashLengthOf(line) ?? lineWidthOf(line) * DASH_LENGTH_RATIO;

/**
 * Rendered tick thickness (along the travel axis), world units: the stored
 * override, else the line width × DASH_WIDTH_RATIO.
 */
export const dashRenderWidth = (
  line: { dashLength?: number; dashWidth?: number; width?: number } | null | undefined,
): number => lineDashWidthOf(line) ?? lineWidthOf(line) * DASH_WIDTH_RATIO;

/**
 * Per-stop dash-tick lookup for the label layout (labelLayout's StopDashFn):
 * the tick's rendered dimensions when the stop's effective style is 'dash',
 * else null. The companion of `stopHalfOf` (lineWidth.ts) — pass the two
 * together at every labelLayoutLocal / stationBoundary / itemBounds site, so
 * the autoAlign pin, the hit rect, and the silhouette all clear the same tick
 * the canvas paints. Takes the stop's whole station `stops` array so it can
 * resolve the SAME split default the canvas does (`stationIsSingleton` is
 * blank-aware), keeping that rule in the model rather than duplicated in
 * geometry — the label clears a tick iff the stop actually paints one.
 */
export const stopDashOf =
  (lines: Record<string, Line | undefined>) =>
  (stop: StopCell, stationStops: readonly StopCell[]): { length: number; width: number } | null => {
    const line = lines[stop.lineId];
    if (resolveDotStyle(line, stop, stationIsSingleton({ stops: stationStops })).shape !== 'dash')
      return null;
    return { length: dashRenderLength(line), width: dashRenderWidth(line) };
  };
