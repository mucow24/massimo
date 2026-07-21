import type {
  DayNightColor,
  DotBaseShape,
  DotFill,
  DotServiceCodeColor,
  DotShape,
  DotStrokeAlign,
  DotStrokeColor,
  DotStyle,
  StyleDef,
} from './types';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import { legibleTextOn } from '../util/color';
import { snapToStep } from '../util/grid';

// A dot showing its service code uses a larger disc than STOP_DOT_RADIUS so
// the code inside stays legible. (Moved here from StopGlyph — the radius is a
// styling rule, not an SVG-assembly detail.)
export const SERVICE_CODE_DOT_RADIUS = 6;

// The DIAMETER a dot renders at when its size is fully tracking defaults —
// larger for a service-code disc so the code stays legible. This MUST equal
// resolveDotRender's untracked radius × 2; it is the single tracking-size the
// size layer collapses to and falls back to (see canonicalDotSize's `dropAt`
// and the dotSize.ts display helpers). Identical to DOT_SIZE_DEFAULT for every
// non-code style, so nothing about plain dots changes.
export const defaultDotDiameter = (style: DotStyle): number =>
  2 * (style.showServiceCode ? SERVICE_CODE_DOT_RADIUS : STOP_DOT_RADIUS);

const K: DayNightColor = { day: '#000000', night: '#000000' };
const W: DayNightColor = { day: '#ffffff', night: '#ffffff' };
// Well-named aliases for reuse outside this file (e.g. the StopDot editor's
// custom-mode fallback pairs), so those can't drift from the preset table's K/W.
export const BLACK_PAIR = K;
export const WHITE_PAIR = W;

// Pinned re-implementations of the legacy DotShape enum. Every preset is
// theme-blind (day === night) so converting old saves changes nothing
// visually; day/night divergence is for future custom styles. 'none' is not
// special-cased anywhere — it's simply a style that draws nothing (no fill,
// no stroke, no code), which `resolveDotRender` resolves to null.
export const DOT_SHAPE_PRESETS: Record<DotShape, DotStyle> = {
  'filled-black': {
    shape: 'circle',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'open-black': {
    shape: 'circle',
    fill: 'none',
    strokeWidth: 1.5,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-black-white-stroke': {
    shape: 'circle',
    fill: K,
    strokeWidth: 2,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-white': {
    shape: 'circle',
    fill: W,
    strokeWidth: 0,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'open-white': {
    shape: 'circle',
    fill: 'none',
    strokeWidth: 1.5,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-white-black-stroke': {
    shape: 'circle',
    fill: W,
    strokeWidth: 2,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-line-color': {
    shape: 'circle',
    fill: 'line',
    strokeWidth: 0,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-line-color-white-stroke': {
    shape: 'circle',
    fill: 'line',
    strokeWidth: 2,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-line-color-black-stroke': {
    shape: 'circle',
    fill: 'line',
    strokeWidth: 2,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-black-service-code': {
    shape: 'circle',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: true,
  },
  'filled-black-diamond': {
    shape: 'diamond',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-white-diamond': {
    shape: 'diamond',
    fill: W,
    strokeWidth: 0,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-black-x': {
    shape: 'x',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  'filled-white-x': {
    shape: 'x',
    fill: W,
    strokeWidth: 0,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
  // The TfL tick. 'line' fill so the bar always paints in its line's color;
  // stroke/code are inert on dash stops (see DotBaseShape doc). Rendered by
  // DashGlyph on canvas; StopGlyph only draws the context-free picker preview.
  dash: {
    shape: 'dash',
    fill: 'line',
    strokeWidth: 0,
    strokeColor: 'line',
    strokeAlign: 'center',
    showServiceCode: false,
  },
  none: {
    shape: 'circle',
    fill: 'none',
    strokeWidth: 0,
    strokeColor: K,
    strokeAlign: 'center',
    showServiceCode: false,
  },
};

// The historical default: `undefined` on `StopCell.dotStyle` defers to the
// line's split default (`singletonDotStyle` / `multiDotStyle` per the stop's
// station case); `undefined` there falls back to this.
export const DEFAULT_DOT_STYLE: DotStyle = DOT_SHAPE_PRESETS['filled-black'];

// The catalog of KNOWN built-in dot looks — one named style per legacy preset,
// in the historical picker order. Its job is RECOGNITION: `bakeStopDotLibrary`
// value-matches an old save's raw dot values against these to tag them by
// preset → id, so importing a pre-library file keeps its dots named. It is NOT
// the fresh-map seed — a new doc ships only `STOP_DOT_SEED_STYLES` below
// (Filled black + the reserved None). Style ids are stable (`stop-<preset>`).
export const DOT_SHAPE_LIBRARY: { id: string; name: string; shape: DotShape }[] = [
  { id: 'stop-filled-black', name: 'Filled black', shape: 'filled-black' },
  { id: 'stop-open-black', name: 'Open black', shape: 'open-black' },
  {
    id: 'stop-filled-black-white-stroke',
    name: 'Filled black with white stroke',
    shape: 'filled-black-white-stroke',
  },
  { id: 'stop-filled-white', name: 'Filled white', shape: 'filled-white' },
  { id: 'stop-open-white', name: 'Open white', shape: 'open-white' },
  {
    id: 'stop-filled-white-black-stroke',
    name: 'Filled white with black stroke',
    shape: 'filled-white-black-stroke',
  },
  { id: 'stop-filled-line-color', name: 'Filled line color', shape: 'filled-line-color' },
  {
    id: 'stop-filled-line-color-white-stroke',
    name: 'Filled line color with white stroke',
    shape: 'filled-line-color-white-stroke',
  },
  {
    id: 'stop-filled-line-color-black-stroke',
    name: 'Filled line color with black stroke',
    shape: 'filled-line-color-black-stroke',
  },
  {
    id: 'stop-filled-black-service-code',
    name: 'Filled black with service code',
    shape: 'filled-black-service-code',
  },
  { id: 'stop-filled-black-diamond', name: 'Filled black diamond', shape: 'filled-black-diamond' },
  { id: 'stop-filled-white-diamond', name: 'Filled white diamond', shape: 'filled-white-diamond' },
  { id: 'stop-filled-black-x', name: 'Filled black X', shape: 'filled-black-x' },
  { id: 'stop-filled-white-x', name: 'Filled white X', shape: 'filled-white-x' },
  { id: 'stop-dash', name: 'Dash (tick)', shape: 'dash' },
  { id: 'stop-none', name: 'None', shape: 'none' },
];

// The stop-dot styles a FRESH map ships with — pruned all the way back to the
// factory default (Filled black) plus the reserved "None" primitive the
// singleton/interchange split and express-skip pattern depend on. Everything
// else in DOT_SHAPE_LIBRARY is recognized on import but not seeded, so a new
// map's "Stop dots" list starts clean; add any other look by defining a style.
// (Literal ids here — NONE_STOP_DOT_STYLE_ID is declared further down.)
export const STOP_DOT_SEED_IDS = ['stop-filled-black', 'stop-none'] as const;

// Style id of the factory default stop-dot (filled black) — the fallback for a
// dot with no explicit style and the seed for new stations. Kept in sync with
// FACTORY_STYLE_DEFAULTS.stopDot.
export const DEFAULT_STOP_DOT_STYLE_ID = 'stop-filled-black';

// The built-in "None" (blank/empty) stop-dot style. It's a primitive the
// singleton/interchange split and the express-skip pattern depend on, and there
// is nothing meaningful to edit (a blank dot). So it's RESERVED: always offered
// in the dot picker, but hidden from the editable Styles list and protected
// from rename/delete. Everything else treats it as an ordinary library style.
export const NONE_STOP_DOT_STYLE_ID = 'stop-none';

// The factory stopDot StyleDefs, keyed by id — spread into DEFAULT_STYLES so
// every fresh (and pre-styles-migrated) doc ships the whole library. Typed as
// the stopDot-narrowed StyleDef so `.props` reads as a concrete DotStyle.
export const STOP_DOT_FACTORY_STYLES: Record<
  string,
  Extract<StyleDef, { kind: 'stopDot' }>
> = Object.fromEntries(
  DOT_SHAPE_LIBRARY.map(({ id, name, shape }) => [
    id,
    { id, name, kind: 'stopDot', props: DOT_SHAPE_PRESETS[shape] } satisfies StyleDef,
  ]),
);

// The stopDot StyleDefs a FRESH doc ships with — the pruned seed (Filled black +
// None), spread into DEFAULT_STYLES. A subset of STOP_DOT_FACTORY_STYLES; the
// rest stay recognizable on import (bakeStopDotLibrary) but unseeded.
export const STOP_DOT_SEED_STYLES: Record<
  string,
  Extract<StyleDef, { kind: 'stopDot' }>
> = Object.fromEntries(STOP_DOT_SEED_IDS.map((id) => [id, STOP_DOT_FACTORY_STYLES[id]]));

/**
 * A dot style that paints NOTHING — no fill, no stroke, no service code. The
 * `none` preset is the canonical one, but any style meeting this condition is
 * effectively blank (`resolveDotRender` returns null for it). Used to
 * short-circuit rendering AND to decide whether a stop OCCUPIES its station for
 * the singleton/interchange split: a stop whose EXPLICIT override is blank —
 * e.g. an express line's skipped stops in the express+local pattern — doesn't
 * count, so the visible stop sharing that station is still treated as a
 * singleton (see `stationIsSingleton`).
 */
export function isBlankDotStyle(style: DotStyle): boolean {
  return style.fill === 'none' && style.strokeWidth === 0 && !style.showServiceCode;
}

/**
 * The effective dot style for a stop: its own `dotStyle` override, else the
 * line's split default for the stop's station case (`singletonDotStyle` when
 * `isSingleton`, else `multiDotStyle`), else DEFAULT_DOT_STYLE (the historical
 * filled-black). `isSingleton` is `stationIsSingleton(station)`. Structural
 * params so narrowed line/stop shapes pass through (same convention as
 * `dotSizeOverride`); re-exported from transforms for its existing callers.
 */
export function resolveDotStyle(
  line: { singletonDotStyle?: DotStyle; multiDotStyle?: DotStyle } | null | undefined,
  stop: { dotStyle?: DotStyle } | null | undefined,
  isSingleton: boolean,
): DotStyle {
  return (
    stop?.dotStyle ??
    (isSingleton ? line?.singletonDotStyle : line?.multiDotStyle) ??
    DEFAULT_DOT_STYLE
  );
}

const dayNight = (c: DayNightColor, darkMode: boolean): string => (darkMode ? c.night : c.day);

function resolveFill(fill: DotFill, lineColor: string | undefined, darkMode: boolean): string {
  if (fill === 'none') return 'none';
  // Fall back to black when the caller has no line in scope (e.g. a picker
  // preview outside any line context) — same convention as badgeColors.
  if (fill === 'line') return lineColor ?? '#000';
  return dayNight(fill, darkMode);
}

// Resolve a 'line'-or-pair color reference — a dot's stroke, or its service
// code — to a concrete SVG color: the 'line' sentinel → the owning line's color
// (black when the caller has no line in scope, matching resolveFill), else the
// theme-picked side of the day/night pair.
function resolveLineOrPairColor(
  color: DotStrokeColor,
  lineColor: string | undefined,
  darkMode: boolean,
): string {
  if (color === 'line') return lineColor ?? '#000';
  return dayNight(color, darkMode);
}

// Concrete per-frame render parameters for one dot. Strings are ready-to-emit
// SVG attribute values; `stroke`/`strokeWidth` are present only when the
// style has a stroke, `code` only when it shows the service code.
export interface DotRenderParams {
  shape: DotBaseShape;
  r: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  // Where the stroke sits relative to the edge. Present only alongside a stroke
  // (see resolveDotRender); consumers treat an absent value as 'center'.
  strokeAlign?: DotStrokeAlign;
  code?: { text: string; color: string };
}

/**
 * The procedural core: resolve a DotStyle to concrete render parameters.
 * Returns null when the style draws nothing (transparent fill, no stroke, no
 * code) — callers render no element at all, preserving the legacy 'none'
 * behavior of an absent glyph.
 */
export function resolveDotRender(
  style: DotStyle,
  lineColor: string | undefined,
  serviceCode: string | undefined,
  darkMode: boolean,
  // Explicit dot DIAMETER from the stop/line override chain
  // (`dotSizeOverride`), halved into r. undefined = fully tracking
  // defaults: keep SERVICE_CODE_DOT_RADIUS for code discs and
  // STOP_DOT_RADIUS otherwise. Callers must pass the override, never the
  // resolved size, or default-tracking code discs would shrink to r 4.
  sizeOverride?: number,
): DotRenderParams | null {
  if (isBlankDotStyle(style)) return null;
  const fill = resolveFill(style.fill, lineColor, darkMode);
  // A 'dash' is a TfL-style tick: on canvas DashGlyph draws it in its fill color
  // and takes its OUTLINE from the owning line's casing, and never draws a
  // service code. So of the style fields only `fill` applies — enforce that in
  // this shared resolver so every consumer agrees (crucially the editor/picker
  // previews via StopGlyph, which would otherwise paint a stroke + code onto the
  // bar that the canvas never renders).
  const isDash = style.shape === 'dash';
  const showCode = style.showServiceCode && !isDash;
  const out: DotRenderParams = {
    shape: style.shape,
    r:
      sizeOverride !== undefined
        ? sizeOverride / 2
        : showCode
          ? SERVICE_CODE_DOT_RADIUS
          : STOP_DOT_RADIUS,
    fill,
  };
  if (style.strokeWidth > 0 && !isDash) {
    out.stroke = resolveLineOrPairColor(style.strokeColor, lineColor, darkMode);
    out.strokeWidth = style.strokeWidth;
    out.strokeAlign = style.strokeAlign;
  }
  if (showCode) {
    // An explicit serviceCodeColor overrides the auto-contrast: 'line' → the
    // owning line's color, a day/night pair → that per-theme color. Absent ⇒
    // judge legibility against what's actually behind the code: the resolved
    // fill, or the canvas background when the fill is transparent.
    const scc = style.serviceCodeColor;
    const color =
      scc !== undefined
        ? resolveLineOrPairColor(scc, lineColor, darkMode)
        : legibleTextOn(fill === 'none' ? (darkMode ? '#000000' : '#ffffff') : fill);
    out.code = { text: serviceCode ?? '?', color };
  }
  return out;
}

function dotColorsEqual(a: DotFill | DotStrokeColor, b: DotFill | DotStrokeColor): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.day === b.day && a.night === b.night;
}

// Optional service-code color: absent compares equal only to absent; two
// present values (each a 'line' sentinel or a day/night pair) compare via
// dotColorsEqual (sentinel-vs-pair never equal).
function optDotColorEqual(
  a: DotServiceCodeColor | undefined,
  b: DotServiceCodeColor | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return dotColorsEqual(a, b);
}

// Stroke width shares the casing width's quarter-unit grid (same stepper
// convention as every other stroke slider).
export const DOT_STROKE_STEP = 0.25;

const lcDayNight = (c: DayNightColor): DayNightColor => ({
  day: c.day.toLowerCase(),
  night: c.night.toLowerCase(),
});
const lcFill = (f: DotFill): DotFill => (typeof f === 'string' ? f : lcDayNight(f));
const lcStroke = (s: DotStrokeColor): DotStrokeColor => (typeof s === 'string' ? s : lcDayNight(s));

/**
 * Canonicalize a DotStyle onto the grids/casing the setters use, rebuilt in the
 * pinned field order (so a panel-edited stopDot style round-trips stringify-
 * stable and compares exactly equal to a stamped one). Colors lowercased,
 * strokeWidth floored at 0 and snapped to the quarter-unit grid.
 */
export function canonicalDotStyle(s: DotStyle): DotStyle {
  const out: DotStyle = {
    shape: s.shape,
    fill: lcFill(s.fill),
    strokeWidth: snapToStep(s.strokeWidth, DOT_STROKE_STEP, 0),
    strokeColor: lcStroke(s.strokeColor),
    strokeAlign: s.strokeAlign,
    showServiceCode: s.showServiceCode,
  };
  // lcStroke passes the 'line' sentinel through and lowercases a day/night pair.
  if (s.serviceCodeColor !== undefined) out.serviceCodeColor = lcStroke(s.serviceCodeColor);
  return out;
}

// Deep equality over canonical style objects — the `===` of the style world,
// used wherever transforms drop a field that lands back on a default.
export function dotStylesEqual(a: DotStyle, b: DotStyle): boolean {
  return (
    a.shape === b.shape &&
    dotColorsEqual(a.fill, b.fill) &&
    a.strokeWidth === b.strokeWidth &&
    dotColorsEqual(a.strokeColor, b.strokeColor) &&
    // Absent strokeAlign means 'center' — so a raw pre-strokeAlign dot style
    // still value-matches the (now strokeAlign-bearing) factory presets during
    // migration, where the bakes run before the field is backfilled. In the live
    // app every style is canonical, so this never fires.
    (a.strokeAlign ?? 'center') === (b.strokeAlign ?? 'center') &&
    a.showServiceCode === b.showServiceCode &&
    optDotColorEqual(a.serviceCodeColor, b.serviceCodeColor)
  );
}
