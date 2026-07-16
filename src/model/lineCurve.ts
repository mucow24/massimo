// Per-line corner-rounding radius, in world units. Historically a doc-global
// option (MapDoc.curveRadius, default 24); now a per-line style field. The
// default IS the historical value — all-default docs render bit-identically
// to the doc-global era. Where interlined lines with different radii share a
// band, the band curves at the LARGEST member radius (see buildBandSpec):
// no line ever curves tighter than it asked for.
export const LINE_CURVE_RADIUS_DEFAULT = 24;
// Transform clamp floor — the historical slider minimum.
export const LINE_CURVE_RADIUS_MIN = 4;
// Slider upper bound only — the textbox may exceed it
// (NumericFieldRow's textboxAllowAboveMax); band-level marker-fit caps keep
// any large value geometrically safe.
export const LINE_CURVE_RADIUS_MAX = 80;
// Radii live on a quarter-unit grid: the slider/steppers move in 0.25
// increments and the setter rounds to the nearest step.
export const LINE_CURVE_RADIUS_STEP = 0.25;

/**
 * The canonical STORED form of a curve radius: round to the
 * LINE_CURVE_RADIUS_STEP (quarter-unit) grid, clamp to ≥ LINE_CURVE_RADIUS_MIN,
 * and collapse to `undefined` (store nothing) when it lands on
 * LINE_CURVE_RADIUS_DEFAULT — the app never stores the default. Shared by the
 * `setLineCurveRadius` transform and the file-import sanitizer so the two can
 * never drift. Callers own the finiteness guard (a transform ignores
 * non-finite input; a sanitizer drops the field).
 */
export const canonicalLineCurveRadius = (r: number): number | undefined => {
  const norm = Math.max(
    LINE_CURVE_RADIUS_MIN,
    Math.round(r / LINE_CURVE_RADIUS_STEP) * LINE_CURVE_RADIUS_STEP,
  );
  return norm === LINE_CURVE_RADIUS_DEFAULT ? undefined : norm;
};

/**
 * Effective curve radius of a line. Missing field ⇒ LINE_CURVE_RADIUS_DEFAULT,
 * so saves from before the field existed need no migration (same idiom as
 * `Line.width`). Structural parameter so narrowed line shapes pass through.
 */
export const lineCurveRadiusOf = (line: { curveRadius?: number } | null | undefined): number =>
  line?.curveRadius ?? LINE_CURVE_RADIUS_DEFAULT;
