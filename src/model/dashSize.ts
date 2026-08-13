import { lineWidthOf } from './lineWidth';
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
// form: floored at 0, kept as given, dropped at exactly 0 (see
// canonicalStrokeWidth), where 0 = "auto" and the width derivation takes over.
export const DASH_LENGTH_MAX = 40;
export const DASH_WIDTH_MAX = 20;

/**
 * Stored dash length — the RAW field (undefined when unset = derive from the
 * line width at render). Structural parameter so narrowed line shapes pass
 * through (same convention as lineStrokeWidthOf).
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
 * True when this line can paint a dash tick anywhere: either line-level
 * default (singleton or interchange) is the dash shape, or any member stop
 * carries an explicit dash override. Drives the LineInspector's conditional
 * Dash length/width rows. Over-showing is deliberate — a dash DEFAULT with no
 * matching station yet still shows the dims you're about to use — while an
 * under-show would hide live controls (a stop resolves to dash only via its
 * override or a line default, so this never misses one).
 */
export const lineUsesDashTicks = (
  line: Line,
  stations: Record<string, { stops: readonly StopCell[] } | undefined>,
): boolean =>
  line.singletonDotStyle?.shape === 'dash' ||
  line.multiDotStyle?.shape === 'dash' ||
  line.stations.some((sid) =>
    stations[sid]?.stops.some((c) => c.lineId === line.id && c.dotStyle?.shape === 'dash'),
  );
