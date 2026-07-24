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

import { roundClamp } from '../util/grid';

// 0 = no casing; the field is dropped at the default so it is never stored.
export const LINE_STROKE_WIDTH_DEFAULT = 0;
// Transform clamp floor (a casing can't be negative).
export const LINE_STROKE_WIDTH_MIN = 0;
// Slider bound only — the textbox may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the rendered rail clamps at the stripe width
// regardless (see lineStrokeRailWidth).
export const LINE_STROKE_WIDTH_MAX = 10;
// Stroke widths live on a quarter-unit grid: the slider/steppers move in
// 0.25 increments and the setters round to the nearest step.
export const LINE_STROKE_STEP = 0.25;
// Stored lowercase; the setter normalizes and drops the field at the
// default so it is never stored.
export const LINE_STROKE_COLOR_DEFAULT = '#ffffff';

/**
 * Sentinel stored in place of a hex in `Line.strokeColor` / `Line.seamColor`:
 * "paint this in the LINE'S OWN color", resolved at render time. Same word and
 * same meaning as the dot styles' 'line' fill/stroke (see DotFill /
 * DotStrokeColor in types.ts), so the two color systems read alike.
 *
 * It survives both canonicalizers untouched — lowercase already, and neither
 * the white-casing default nor the transparent-seam "off" test matches it — so
 * it stores, round-trips, and stamps like any other color value.
 */
export const LINE_OWN_COLOR = 'line';

/**
 * The canonical STORED form of a casing width: round to the LINE_STROKE_STEP
 * (quarter-unit) grid, clamp to ≥ LINE_STROKE_WIDTH_MIN, and collapse to
 * `undefined` at LINE_STROKE_WIDTH_DEFAULT (0 = no casing, never stored).
 * Shared by the `setLineStrokeWidth` transform and the `sanitizeLineStroke`
 * file cleaner so the grid/floor can never drift. Callers own the finiteness
 * guard.
 */
export const canonicalStrokeWidth = (w: number): number | undefined => {
  const norm = roundClamp(w, LINE_STROKE_STEP, LINE_STROKE_WIDTH_MIN);
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

/**
 * The STORED casing color — the raw field, with only the missing-field default
 * (white) applied. May be the {@link LINE_OWN_COLOR} sentinel, so this is NOT a
 * paintable value: renderers want {@link lineCasingColor}. Capture-by-example
 * and the editors' mode pickers want this one, so a style defined from a
 * line-colored casing captures the SENTINEL rather than baking that one line's
 * hue.
 */
export const lineStrokeColorStored = (line: { strokeColor?: string } | null | undefined): string =>
  line?.strokeColor ?? LINE_STROKE_COLOR_DEFAULT;

/**
 * The STORED seam color. Unlike the casing there is NO default color: absent ⇒
 * NO seam (the overlaps stay merged), so this returns undefined when unset —
 * which is also how callers test "does this line have a seam at all" (the
 * sentinel counts as one). Raw like {@link lineStrokeColorStored}; renderers
 * want {@link lineSeamColor}.
 */
export const lineSeamColorStored = (
  line: { seamColor?: string } | null | undefined,
): string | undefined => line?.seamColor;

/**
 * Resolve a stored casing/seam color to a paintable one: the
 * {@link LINE_OWN_COLOR} sentinel becomes `lineColor`, anything else passes
 * through. `lineColor` is the EFFECTIVE body color, so a line-colored casing
 * tracks the selection desaturation with the body instead of popping at full
 * saturation. Picker-less callers with no line to hand (see DashGlyph) pass
 * undefined and get the white casing default — the literal word must never
 * reach an SVG paint attribute.
 */
const resolveOwnColor = (stored: string, lineColor: string | undefined): string =>
  stored === LINE_OWN_COLOR ? (lineColor ?? LINE_STROKE_COLOR_DEFAULT) : stored;

/** Paintable casing color: {@link lineStrokeColorStored} with the sentinel resolved. */
export const lineCasingColor = (
  line: { strokeColor?: string } | null | undefined,
  lineColor: string | undefined,
): string => resolveOwnColor(lineStrokeColorStored(line), lineColor);

/** Paintable seam color, or undefined when the line has no seam. */
export const lineSeamColor = (
  line: { seamColor?: string } | null | undefined,
  lineColor: string | undefined,
): string | undefined => {
  const stored = lineSeamColorStored(line);
  return stored === undefined ? undefined : resolveOwnColor(stored, lineColor);
};

/**
 * Canonical STORED form of a seam color: lowercased, and collapsed to
 * `undefined` when fully transparent (alpha `00`) — the "off" state — so a
 * disabled seam is never stored. Mirrors {@link canonicalStrokeColor} (the
 * picker already normalizes shorthand/opaque via normalizeHex; hand-edited
 * files may carry uppercase). Shared by `setLineSeamColor` and the file cleaner.
 */
export const canonicalSeamColor = (c: string): string | undefined => {
  const norm = c.toLowerCase();
  return /^#[0-9a-f]{6}00$/.test(norm) ? undefined : norm;
};

/**
 * Stored seam width, per side, in world units — the RAW field (undefined when
 * unset). Stored/canonicalized exactly like the casing width (drop at 0 via
 * {@link canonicalStrokeWidth}), so an UNSET seam width is `undefined`, not 0.
 * The render distinguishes the two (see {@link seamRenderWidth}).
 */
export const lineSeamWidthOf = (
  line: { seamWidth?: number } | null | undefined,
): number | undefined => line?.seamWidth;

/**
 * The rendered seam stroke width for a stripe of `bandWidth`. The seam sits
 * CENTERED on the body edge (like the casing), so an UNSET seam width inherits
 * the casing rail width `railW` — a seam-color-only line still shows a seam
 * matched to its casing — while an explicit width overrides it. Clamped to the
 * band width so the two edge seams never cross at the centerline. Returns 0
 * (no seam) only when both the stored width is unset AND there is no casing.
 */
export const seamRenderWidth = (
  seamWidth: number | undefined,
  railW: number,
  bandWidth: number,
): number => Math.min(seamWidth ?? railW, bandWidth);

/**
 * The rendered rail width for a stripe of the given body width: each rail
 * is centered on a body edge (spanning [width/2 − rail/2, width/2 + rail/2]
 * per side), so a rail wider than the body is meaningless (the two rails
 * would cross at the centerline). The stored value is uncapped (the textbox
 * allows anything ≥ 0); this clamp is render-time only.
 */
export const lineStrokeRailWidth = (strokeWidth: number, width: number): number =>
  Math.min(strokeWidth, width);

/**
 * The two stroke widths that render a stripe's casing as a SILHOUETTE + INSET
 * BODY (the merge-friendly equivalent of the two centered rails). The
 * silhouette is the body OUTSET by `railW` — so the casing shows `railW/2`
 * past each edge; the inset body is the body NARROWED by `railW` — so the
 * casing shows `railW/2` inside each edge. Painted silhouette-under-body they
 * reproduce the centered-rail look pixel-for-pixel (colored core `width −
 * railW`, casing ring `railW`, outer extent `width/2 + railW/2`) while letting
 * a line's own overlapping bands merge into ONE outer casing — every
 * silhouette paints before every body, so a body always re-covers a same-line
 * silhouette in the interior. Shared by SegmentBand, the highlight overlay,
 * and the self-overdraw test so the three can't drift.
 *
 * Only for OPAQUE-interior styles (solid / dashed / hatched): an "open" style
 * (dashed-open, dotted) has transparent gaps, so a solid silhouette behind it
 * would show through — those keep the centered rails instead.
 */
export const casingSilhouetteWidth = (width: number, railW: number): number => width + railW;
export const casingInsetBodyWidth = (width: number, railW: number): number =>
  Math.max(0, width - railW);
