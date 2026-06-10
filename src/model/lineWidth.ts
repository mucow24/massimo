import { STOP_SIZE } from '../geometry/orientation';

// Per-line stripe width, in world units. The default IS the historical
// constant — `LINE_WIDTH_DEFAULT === STOP_SIZE` is what makes all-default
// docs render bit-identically to the pre-feature app. Note the distinction:
// STOP_SIZE remains the LATTICE pitch (one row/col unit of stop-cell space),
// which does not scale with line width; only the painted stripe/marker
// geometry reads these.
export const LINE_WIDTH_DEFAULT = STOP_SIZE;
// Transform clamp floor. The inspector textbox/steppers accept anything ≥ 1.
export const LINE_WIDTH_MIN = 1;
// Slider bounds only — the textbox may exceed LINE_WIDTH_MAX
// (NumericFieldRow's textboxAllowAboveMax) and go below LINE_WIDTH_SLIDER_MIN
// down to LINE_WIDTH_MIN.
export const LINE_WIDTH_SLIDER_MIN = 2;
export const LINE_WIDTH_MAX = 28;

/**
 * Effective render width of a line. Missing field ⇒ LINE_WIDTH_DEFAULT, so
 * saves from before the field existed need no migration (same idiom as
 * `Line.defaultDotShape`). Structural parameter so narrowed line shapes
 * (e.g. StopGrid's lines prop) pass through.
 */
export const lineWidthOf = (line: { width?: number } | null | undefined): number =>
  line?.width ?? LINE_WIDTH_DEFAULT;

/**
 * Per-line half-width lookup keyed by line id — the single home for the
 * `width / 2` derivation that station-local geometry (boundary AABB, label
 * snap) needs per stop. Unknown ids fall back to the default half, matching
 * how orphan stops render.
 */
export const stopHalfOf =
  (lines: Record<string, { width?: number } | undefined>) =>
  (id: string): number =>
    lineWidthOf(lines[id]) / 2;
