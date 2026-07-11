// Per-line stroke (casing): an optional pair of side rails CENTERED on the
// line's body edges — half in, half out, like SVG's own stroke on a shape
// boundary — in a second color. MTA-style separators. Centering is
// load-bearing twice over:
//   1. Between two tangent stroked lines, the neighbors' facing rails
//      OCCUPY THE SAME PIXELS (both centered on the shared edge), so the
//      separator is one stroke wide — not two stacked — and an interlined
//      band reads with uniform stroke weight on every edge, outer included.
//   2. The rails are anchored to the edges themselves, so draw order and
//      segment layering can change which line's rail is on top (visible
//      only when neighbors' stroke COLORS differ) but never WHERE the
//      separator sits.
// Unlike `width`, stroke is PRESENTATION, not geometry — it never moves
// paths, changes tangency/band merging, or affects station layout.
// Renderers resolve it live from the line (like color), so edits repaint
// without a geometry rebuild.

// 0 = no casing; the field is dropped at the default so it is never stored.
export const LINE_STROKE_WIDTH_DEFAULT = 0;
// Transform clamp floor (a casing can't be negative).
export const LINE_STROKE_WIDTH_MIN = 0;
// Slider bound only — the textbox may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the rendered rail clamps at the stripe width
// regardless (see lineStrokeRailWidth).
export const LINE_STROKE_WIDTH_MAX = 10;
// Stroke widths live on a half-pixel grid: the slider/steppers move in
// 0.5 increments and the setters round to the nearest step.
export const LINE_STROKE_STEP = 0.5;
// Stored lowercase; the setter normalizes and drops the field at the
// default so it is never stored.
export const LINE_STROKE_COLOR_DEFAULT = '#ffffff';

/**
 * The canonical STORED form of a casing width: round to the LINE_STROKE_STEP
 * (half-pixel) grid, clamp to ≥ LINE_STROKE_WIDTH_MIN, and collapse to
 * `undefined` at LINE_STROKE_WIDTH_DEFAULT (0 = no casing, never stored).
 * Shared by the `setLineStrokeWidth` transform and the `sanitizeLineStroke`
 * file cleaner so the grid/floor can never drift. Callers own the finiteness
 * guard.
 */
export const canonicalStrokeWidth = (w: number): number | undefined => {
  const norm = Math.max(LINE_STROKE_WIDTH_MIN, Math.round(w / LINE_STROKE_STEP) * LINE_STROKE_STEP);
  return norm === LINE_STROKE_WIDTH_DEFAULT ? undefined : norm;
};

/**
 * The canonical STORED form of a casing color: lowercased, and collapsed to
 * `undefined` at the white default (never stored). Shared by
 * `setLineStrokeColor` and `sanitizeLineStroke`.
 */
export const canonicalStrokeColor = (c: string): string | undefined => {
  const norm = c.toLowerCase();
  return norm === LINE_STROKE_COLOR_DEFAULT ? undefined : norm;
};

/**
 * Effective casing width of a line, per side, in world units. Missing field
 * ⇒ no casing — saves from before the field existed need no migration (same
 * idiom as `lineWidthOf`). Structural parameter so narrowed line shapes pass
 * through.
 */
export const lineStrokeWidthOf = (line: { strokeWidth?: number } | null | undefined): number =>
  line?.strokeWidth ?? LINE_STROKE_WIDTH_DEFAULT;

/** Effective casing color. Missing field ⇒ the white default. */
export const lineStrokeColorOf = (line: { strokeColor?: string } | null | undefined): string =>
  line?.strokeColor ?? LINE_STROKE_COLOR_DEFAULT;

/**
 * The rendered rail width for a stripe of the given body width: each rail
 * is centered on a body edge (spanning [width/2 − rail/2, width/2 + rail/2]
 * per side), so a rail wider than the body is meaningless (the two rails
 * would cross at the centerline). The stored value is uncapped (the textbox
 * allows anything ≥ 0); this clamp is render-time only.
 */
export const lineStrokeRailWidth = (strokeWidth: number, width: number): number =>
  Math.min(strokeWidth, width);
