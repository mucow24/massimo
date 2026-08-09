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
import { resolveDayNight, sentinelOrDayNightEqual } from './dayNightColor';
import type { DayNightColor, LineStrokeColor } from './types';

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
// The casing's theme-aware default: white on BOTH canvases — the historical
// single-color look, so a save from before the day/night split repaints
// identically in either mode. Stored lowercase; the setter normalizes and drops
// the field when BOTH halves land here, so the default is never stored.
export const LINE_STROKE_COLOR_DEFAULT: DayNightColor = { day: '#ffffff', night: '#ffffff' };

/**
 * Sentinel stored in place of a hex in `Line.strokeColor`: "paint this in the
 * LINE'S OWN color", resolved at render time. Same word and same meaning as
 * the dot styles' 'line' fill/stroke (see DotFill / DotStrokeColor in
 * types.ts), so the two color systems read alike.
 *
 * It survives the canonicalizer untouched — lowercase already, and the
 * white-casing default doesn't match it — so it stores, round-trips, and
 * stamps like any other color value.
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
 * Structural equality for a casing color: the {@link LINE_OWN_COLOR} sentinel
 * matches only itself, two day/night pairs compare half by half. The `===` of
 * the casing world — what `stylePropsEqual` and the setters' drop-at-default
 * read, so neither can regress to comparing pairs by reference.
 */
export const lineStrokeColorsEqual = (a: LineStrokeColor, b: LineStrokeColor): boolean =>
  sentinelOrDayNightEqual(a, b);

/**
 * Lowercase a casing color without collapsing it — the sentinel passes through,
 * a pair gets both halves lowercased. The style-def canonicalizer wants this
 * one (style props are concrete: they store the default rather than dropping
 * it); the per-line setter wants {@link canonicalStrokeColor} below.
 */
export const normalizedStrokeColor = (c: LineStrokeColor): LineStrokeColor =>
  typeof c === 'string' ? c : { day: c.day.toLowerCase(), night: c.night.toLowerCase() };

/**
 * The canonical STORED form of a casing color: lowercased, and collapsed to
 * `undefined` when it equals the white default (never stored). The collapse is
 * all-or-nothing over BOTH halves, like a transfer's theme-aware color — a
 * white day casing over a black night one is a real override. Shared by
 * `setLineStrokeColor` and `sanitizeLineStroke`.
 */
export const canonicalStrokeColor = (c: LineStrokeColor): LineStrokeColor | undefined => {
  const norm = normalizedStrokeColor(c);
  return lineStrokeColorsEqual(norm, LINE_STROKE_COLOR_DEFAULT) ? undefined : norm;
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
export const lineStrokeColorStored = (
  line: { strokeColor?: LineStrokeColor } | null | undefined,
): LineStrokeColor => line?.strokeColor ?? LINE_STROKE_COLOR_DEFAULT;

/**
 * Paintable casing color for the active theme: the {@link LINE_OWN_COLOR}
 * sentinel becomes `lineColor`, a day/night pair resolves to its day half in
 * light mode and its night half in dark. `lineColor` is the EFFECTIVE body
 * color, so a line-colored casing tracks the selection desaturation with the
 * body instead of popping at full saturation — and it is theme-blind (a line's
 * body color has no night half), so the sentinel resolves the same on both
 * canvases. Picker-less callers with no line to hand (see DashGlyph) pass
 * undefined and get the white casing default — the literal word must never
 * reach an SVG paint attribute.
 */
export const lineCasingColor = (
  line: { strokeColor?: LineStrokeColor } | null | undefined,
  lineColor: string | undefined,
  darkMode: boolean,
): string => {
  const stored = lineStrokeColorStored(line);
  if (stored === LINE_OWN_COLOR) {
    return lineColor ?? resolveDayNight(LINE_STROKE_COLOR_DEFAULT, darkMode);
  }
  return resolveDayNight(stored, darkMode);
};

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
