import { STOP_SIZE } from '../geometry/orientation';
import { roundClamp } from '../util/grid';

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
  const norm = roundClamp(w, LINE_WIDTH_STEP, LINE_WIDTH_MIN);
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

// Clearance a station label keeps from this line's marker, world units. The
// default IS the historical LABEL_GAP constant, so all-default docs place
// labels bit-identically to the pre-feature app. Unlike interlineGap, 0 is a
// REAL value (text butted to the marker) and NEGATIVE values are legal too —
// ink deliberately into the marker: the canonical form collapses at the
// DEFAULT, never at 0, and floors at LINE_LABEL_GAP_MIN so an extreme value
// stays a bounded style choice rather than flinging the label across the stop.
export const LINE_LABEL_GAP_DEFAULT = 3;
// Slider bounds; the textbox may exceed the MAX (textboxAllowAboveMax) but
// the MIN is the transform's hard floor.
export const LINE_LABEL_GAP_MIN = -10;
export const LINE_LABEL_GAP_MAX = 10;

/**
 * The canonical STORED form of a label gap: round to the quarter-unit grid,
 * clamp to ≥ LINE_LABEL_GAP_MIN, and collapse to `undefined` (store nothing)
 * when it lands on LINE_LABEL_GAP_DEFAULT — the app never stores the default.
 * Shared by the `setLineLabelGap` transform, the style-props canonicalizer and
 * the file-import cleaner so the three can never drift. Callers own the
 * finiteness guard (a transform ignores non-finite input; a sanitizer drops
 * the field).
 */
export const canonicalLineLabelGap = (v: number): number | undefined => {
  const norm = roundClamp(v, LINE_WIDTH_STEP, LINE_LABEL_GAP_MIN);
  return norm === LINE_LABEL_GAP_DEFAULT ? undefined : norm;
};

/**
 * Effective label gap of a line. Missing field ⇒ 3 (the historical constant)
 * — saves from before the field existed need no migration. Structural
 * parameter so narrowed line shapes pass through.
 */
export const lineLabelGapOf = (line: { labelGap?: number } | null | undefined): number =>
  line?.labelGap ?? LINE_LABEL_GAP_DEFAULT;
