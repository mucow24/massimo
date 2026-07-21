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
// Widths live on a quarter-unit grid: the slider/steppers move in 0.25
// increments and the setter rounds to the nearest step.
export const LINE_WIDTH_STEP = 0.25;

/**
 * The canonical STORED form of a stripe width: round to the LINE_WIDTH_STEP
 * (quarter-unit) grid, clamp to ≥ LINE_WIDTH_MIN, and collapse to `undefined`
 * (store nothing) when it lands on LINE_WIDTH_DEFAULT — the app never stores
 * the default. This is the one home for that arithmetic, shared by the
 * `setLineWidth` transform and the `sanitizeLineWidth` file-import cleaner so
 * the two can never drift. Callers own the finiteness guard, because they
 * diverge on non-finite input (a transform ignores it and keeps the current
 * value; a sanitizer drops the field).
 */
export const canonicalLineWidth = (w: number): number | undefined => {
  const norm = Math.max(LINE_WIDTH_MIN, Math.round(w / LINE_WIDTH_STEP) * LINE_WIDTH_STEP);
  return norm === LINE_WIDTH_DEFAULT ? undefined : norm;
};

/**
 * Effective render width of a line. Missing field ⇒ LINE_WIDTH_DEFAULT, so
 * saves from before the field existed need no migration (same idiom as
 * `Line.singletonDotStyle`). Structural parameter so narrowed line shapes
 * (e.g. StopGrid's lines prop) pass through.
 */
export const lineWidthOf = (line: { width?: number } | null | undefined): number =>
  line?.width ?? LINE_WIDTH_DEFAULT;

// Extra spacing between a line and each interlined neighbor, world units.
// 0 = today's edge-to-edge tangency; never stored at the default. Stored on
// the same quarter-unit grid as the casing width (canonicalStrokeWidth —
// grid + floor-at-0 + drop-at-0 is exactly this field's contract too).
// Where two neighbors disagree, the pair uses the LARGER gap (see
// tangentGap in geometry/orientation.ts). GEOMETRY, like `width`.
export const LINE_INTERLINE_GAP_DEFAULT = 0;
// Slider bound only — the textbox may exceed it (textboxAllowAboveMax).
export const LINE_INTERLINE_GAP_MAX = STOP_SIZE;

/**
 * Effective interline gap of a line. Missing field ⇒ 0 (tangent, the
 * historical behavior) — saves from before the field existed need no
 * migration. Structural parameter so narrowed line shapes pass through.
 */
export const lineInterlineGapOf = (line: { interlineGap?: number } | null | undefined): number =>
  line?.interlineGap ?? LINE_INTERLINE_GAP_DEFAULT;

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
