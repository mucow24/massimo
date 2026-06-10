import type {
  DayNightColor,
  DotBaseShape,
  DotFill,
  DotShape,
  DotStrokeColor,
  DotStyle,
} from './types';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import { legibleTextOn } from '../util/color';

// A dot showing its service code uses a larger disc than STOP_DOT_RADIUS so
// the code inside stays legible. (Moved here from StopGlyph — the radius is a
// styling rule, not an SVG-assembly detail.)
export const SERVICE_CODE_DOT_RADIUS = 6;

const K: DayNightColor = { day: '#000000', night: '#000000' };
const W: DayNightColor = { day: '#ffffff', night: '#ffffff' };

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
    showServiceCode: false,
  },
  'open-black': {
    shape: 'circle',
    fill: 'none',
    strokeWidth: 1.5,
    strokeColor: K,
    showServiceCode: false,
  },
  'filled-black-white-stroke': {
    shape: 'circle',
    fill: K,
    strokeWidth: 2,
    strokeColor: W,
    showServiceCode: false,
  },
  'filled-white': {
    shape: 'circle',
    fill: W,
    strokeWidth: 0,
    strokeColor: K,
    showServiceCode: false,
  },
  'open-white': {
    shape: 'circle',
    fill: 'none',
    strokeWidth: 1.5,
    strokeColor: W,
    showServiceCode: false,
  },
  'filled-white-black-stroke': {
    shape: 'circle',
    fill: W,
    strokeWidth: 2,
    strokeColor: K,
    showServiceCode: false,
  },
  'filled-line-color': {
    shape: 'circle',
    fill: 'line',
    strokeWidth: 0,
    strokeColor: W,
    showServiceCode: false,
  },
  'filled-black-service-code': {
    shape: 'circle',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    showServiceCode: true,
  },
  'filled-black-diamond': {
    shape: 'diamond',
    fill: K,
    strokeWidth: 0,
    strokeColor: W,
    showServiceCode: false,
  },
  'filled-white-diamond': {
    shape: 'diamond',
    fill: W,
    strokeWidth: 0,
    strokeColor: K,
    showServiceCode: false,
  },
  'filled-black-x': { shape: 'x', fill: K, strokeWidth: 0, strokeColor: W, showServiceCode: false },
  'filled-white-x': { shape: 'x', fill: W, strokeWidth: 0, strokeColor: K, showServiceCode: false },
  none: { shape: 'circle', fill: 'none', strokeWidth: 0, strokeColor: K, showServiceCode: false },
};

// The historical default: `undefined` on `StopCell.dotStyle` defers to the
// line's `defaultDotStyle`; `undefined` there falls back to this.
export const DEFAULT_DOT_STYLE: DotStyle = DOT_SHAPE_PRESETS['filled-black'];

const dayNight = (c: DayNightColor, darkMode: boolean): string => (darkMode ? c.night : c.day);

function resolveFill(fill: DotFill, lineColor: string | undefined, darkMode: boolean): string {
  if (fill === 'none') return 'none';
  // Fall back to black when the caller has no line in scope (e.g. a picker
  // preview outside any line context) — same convention as badgeColors.
  if (fill === 'line') return lineColor ?? '#000';
  return dayNight(fill, darkMode);
}

function resolveStrokeColor(
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
): DotRenderParams | null {
  if (style.fill === 'none' && style.strokeWidth === 0 && !style.showServiceCode) return null;
  const fill = resolveFill(style.fill, lineColor, darkMode);
  const out: DotRenderParams = {
    shape: style.shape,
    r: style.showServiceCode ? SERVICE_CODE_DOT_RADIUS : STOP_DOT_RADIUS,
    fill,
  };
  if (style.strokeWidth > 0) {
    out.stroke = resolveStrokeColor(style.strokeColor, lineColor, darkMode);
    out.strokeWidth = style.strokeWidth;
  }
  if (style.showServiceCode) {
    // Legibility is judged against what's actually behind the code: the
    // resolved fill, or the canvas background when the fill is transparent.
    const bg = fill === 'none' ? (darkMode ? '#000000' : '#ffffff') : fill;
    out.code = { text: serviceCode ?? '?', color: legibleTextOn(bg) };
  }
  return out;
}

function dotColorsEqual(a: DotFill | DotStrokeColor, b: DotFill | DotStrokeColor): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.day === b.day && a.night === b.night;
}

// Deep equality over canonical style objects — the `===` of the style world,
// used wherever transforms drop a field that lands back on a default.
export function dotStylesEqual(a: DotStyle, b: DotStyle): boolean {
  return (
    a.shape === b.shape &&
    dotColorsEqual(a.fill, b.fill) &&
    a.strokeWidth === b.strokeWidth &&
    dotColorsEqual(a.strokeColor, b.strokeColor) &&
    a.showServiceCode === b.showServiceCode
  );
}
