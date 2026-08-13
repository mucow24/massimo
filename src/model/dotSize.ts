import { STOP_DOT_RADIUS } from '../geometry/orientation';
import { clampField } from '../util/grid';
import { DEFAULT_DOT_STYLE, defaultDotDiameter, resolveDotStyle } from './dotStyle';
import type { DotStyle } from './types';

// Structural shapes carrying just what the size resolvers read: the split size
// overrides AND the split dot styles. The style picks the size a dot renders at
// when fully tracking (12 for a service-code disc, 8 otherwise), so it must be
// in scope wherever a resolver falls back to that default.
type SizedLine = {
  singletonDotSize?: number;
  multiDotSize?: number;
  singletonDotStyle?: DotStyle;
  multiDotStyle?: DotStyle;
};
type SizedStop = { dotSize?: number; dotStyle?: DotStyle };

// Stop dot size, expressed as the dot's DIAMETER in px. The default derives
// from STOP_DOT_RADIUS so the "missing ⇒ default" chain renders identically
// to the pre-feature app (same idiom as LINE_WIDTH_DEFAULT === STOP_SIZE).
export const DOT_SIZE_DEFAULT = 2 * STOP_DOT_RADIUS;
// Transform clamp floor AND slider min — 0 (an invisible dot) is legal.
export const DOT_SIZE_MIN = 0;
// Slider bound only — the textboxes may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the transforms clamp only the floor, mirroring
// setLineWidth.
export const DOT_SIZE_MAX = 20;
// The dot-size slider/steppers move in 0.25 increments (matching
// LINE_WIDTH_STEP / LINE_STROKE_STEP), and the default (8) sits on that grid.
// A step is what the CONTROLS move by — a typed size is stored as typed.
export const DOT_SIZE_STEP = 0.25;

/**
 * The canonical STORED form of a PER-STOP dot size (diameter px): clamp to
 * ≥ DOT_SIZE_MIN, and
 * collapse to `undefined` when it equals `dropAt` — the line's size for the
 * stop's singleton/shared case, which an absent field defers to. Shared by
 * the `setDotSize` transform and the `sanitizeStopDotSizes` file cleaner so
 * the clamp rule can never drift. LINE sizes never collapse (always stored);
 * their setters clamp only. Callers own the finiteness guard (they diverge on
 * non-finite input).
 */
export const canonicalDotSize = (
  size: number,
  dropAt: number = DOT_SIZE_DEFAULT,
): number | undefined => {
  const norm = clampField(size, DOT_SIZE_MIN);
  return norm === dropAt ? undefined : norm;
};

// The line-default size for a stop, chosen by whether its station is a
// singleton (this line's only stop there) or shared with another line. Missing
// field ⇒ undefined (fully tracking) — the caller adds the DOT_SIZE_DEFAULT
// fallback where appropriate.
const lineDotSizeFor = (
  line: { singletonDotSize?: number; multiDotSize?: number } | null | undefined,
  isSingleton: boolean,
): number | undefined => (isSingleton ? line?.singletonDotSize : line?.multiDotSize);

/**
 * The OVERRIDE-ONLY size: stop override, else the line default for the stop's
 * singleton/shared case, else undefined. `undefined` means "fully tracking
 * defaults" — rendering then keeps the per-style fixed radii
 * (SERVICE_CODE_DOT_RADIUS for code discs, STOP_DOT_RADIUS otherwise), which is
 * why this must NOT collapse to DOT_SIZE_DEFAULT. `isSingleton` is
 * `station.stops.length === 1` (see stationIsSingleton). Structural parameters
 * so narrowed line/stop shapes pass through (same convention as lineWidthOf).
 */
export const dotSizeOverride = (
  line: { singletonDotSize?: number; multiDotSize?: number } | null | undefined,
  stop: { dotSize?: number } | null | undefined,
  isSingleton: boolean,
): number | undefined => stop?.dotSize ?? lineDotSizeFor(line, isSingleton);

/**
 * Fully-resolved size for UI display (the station inspector textbox). NOT
 * for rendering — see dotSizeOverride. A fully-tracking dot reports the
 * diameter its STYLE renders at (12 for a service-code disc, 8 otherwise), so
 * the shown number never contradicts the dot on the canvas.
 */
export const resolveDotSize = (
  line: SizedLine | null | undefined,
  stop: SizedStop | null | undefined,
  isSingleton: boolean,
): number =>
  dotSizeOverride(line, stop, isSingleton) ??
  defaultDotDiameter(resolveDotStyle(line, stop, isSingleton));

/**
 * Effective singleton / shared line-default sizes for the LineInspector
 * sliders. A missing field reports the case's default STYLE diameter (12 for a
 * service-code disc, 8 otherwise) — the size the dot actually renders — so
 * saves from before the field existed need no migration (mirrors lineWidthOf).
 */
export const lineSingletonDotSizeOf = (line: SizedLine | null | undefined): number =>
  line?.singletonDotSize ?? defaultDotDiameter(line?.singletonDotStyle ?? DEFAULT_DOT_STYLE);

export const lineMultiDotSizeOf = (line: SizedLine | null | undefined): number =>
  line?.multiDotSize ?? defaultDotDiameter(line?.multiDotStyle ?? DEFAULT_DOT_STYLE);
