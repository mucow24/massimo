// Per-transfer style overrides of the CONSTANT transfer defaults below. The
// sentinel for "the default" is an ABSENT optional field on the Transfer:
// the setters collapse a value equal to the default to `undefined` (same
// contract as StopCell.dotStyle / dotSize and Line.width), so persisted
// state stays clean. There are no doc-level transfer settings — map-wide
// restyling goes through the "Default" transfer style preset instead (its
// editor re-stamps every transfer wearing it).

import { roundClamp } from '../util/grid';
import type { DayNightColor } from './types';

// Transform clamp floor; the slider min too.
export const TRANSFER_THICKNESS_MIN = 1;
// Slider bound only — the textbox may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the transforms clamp only the floor.
export const TRANSFER_THICKNESS_MAX = 14;
// Thickness lives on a quarter-unit grid: the slider/steppers move in 0.25
// increments and the setter rounds to the nearest step (like the outline width
// and line stroke).
export const TRANSFER_THICKNESS_STEP = 0.25;
// The legacy hard-coded look: 2px body, no outline. Body and outline colors
// are theme-aware (day/night); the defaults are black in both themes for the
// body and white in both for the outline — so old, single-color maps read
// identically until a night color is chosen.
export const TRANSFER_THICKNESS_DEFAULT = 2;
export const TRANSFER_COLOR_DEFAULT: DayNightColor = { day: '#000000', night: '#000000' };

// 0 = no outline; a legal, stored value (the DOC setting defaults to it —
// unlike line casings, transfer stroke width is a required doc field).
export const TRANSFER_STROKE_WIDTH_MIN = 0;
// Slider bound only, like TRANSFER_THICKNESS_MAX.
export const TRANSFER_STROKE_WIDTH_MAX = 5;
export const TRANSFER_STROKE_WIDTH_DEFAULT = 0;
// Outline width lives on a quarter-unit grid: the slider/steppers move in 0.25
// increments and the setter rounds to the nearest step. (Same grid as the body
// thickness above.)
export const TRANSFER_STROKE_WIDTH_STEP = 0.25;
export const TRANSFER_STROKE_COLOR_DEFAULT: DayNightColor = { day: '#ffffff', night: '#ffffff' };

// The four style knobs a transfer can override — also the shape of the
// constant defaults they fall back to. `color`/`strokeColor` are theme-aware:
// each paints its `day` half in light mode and `night` half in dark.
export interface TransferStyle {
  thickness: number;
  color: DayNightColor;
  strokeWidth: number;
  strokeColor: DayNightColor;
}

// The constant fallback for every unset override — the legacy hard-coded
// look. One frozen object so render paths can pass it by reference.
export const TRANSFER_STYLE_DEFAULTS: TransferStyle = {
  thickness: TRANSFER_THICKNESS_DEFAULT,
  color: TRANSFER_COLOR_DEFAULT,
  strokeWidth: TRANSFER_STROKE_WIDTH_DEFAULT,
  strokeColor: TRANSFER_STROKE_COLOR_DEFAULT,
};

// Structural equality for a theme-aware color: both halves must match. The
// `===` of the day/night world, used wherever a transfer override is dropped
// at a default (mirrors dotStyle's `dotColorsEqual`, minus the sentinels).
export const dayNightColorsEqual = (a: DayNightColor, b: DayNightColor): boolean =>
  a.day === b.day && a.night === b.night;

// Resolve a theme-aware color to the concrete hex for the active theme: the
// night half in dark mode, the day half otherwise. Mirrors dotStyle's private
// `dayNight` and `resolvePolygonColors`.
export const resolveDayNight = (c: DayNightColor, darkMode: boolean): string =>
  darkMode ? c.night : c.day;

// Wrap a legacy single-color string as a theme-aware color: old docs stored
// one color that applied in both themes, so day AND night both take it (old
// colors are "day" colors, and the night half matches until re-chosen). Passes
// an already-resolved DayNightColor straight through, so the load paths can
// re-run it idempotently. The exact legacy string is preserved (casing
// included) — transfer colors are compared exactly, never normalized.
export const legacyColorToDayNight = (c: DayNightColor | string): DayNightColor =>
  typeof c === 'string' ? { day: c, night: c } : c;

/**
 * The canonical STORED form of a per-transfer thickness override: round to the
 * TRANSFER_THICKNESS_STEP (quarter-unit) grid, clamp to ≥ TRANSFER_THICKNESS_MIN,
 * and collapse to `undefined` when it equals `dropAt` — the constant default
 * the value would otherwise redundantly duplicate. Shared by the
 * `updateTransferStyle` transform and the `sanitizeTransferStyles` file cleaner
 * so the clamp rule can never drift (same idiom as canonicalDotSize). Callers
 * own the finiteness guard.
 */
export const canonicalTransferThickness = (n: number, dropAt: number): number | undefined => {
  const norm = roundClamp(n, TRANSFER_THICKNESS_STEP, TRANSFER_THICKNESS_MIN);
  return norm === dropAt ? undefined : norm;
};

/**
 * Same contract as canonicalTransferThickness for the outline width, on the
 * TRANSFER_STROKE_WIDTH_STEP (quarter-unit) grid.
 */
export const canonicalTransferStrokeWidth = (n: number, dropAt: number): number | undefined => {
  const norm = roundClamp(n, TRANSFER_STROKE_WIDTH_STEP, TRANSFER_STROKE_WIDTH_MIN);
  return norm === dropAt ? undefined : norm;
};

/**
 * The canonical STORED form of a per-transfer color override: collapsed to
 * `undefined` at the constant default. Structural (both-halves) equality —
 * every in-app write comes from ColorField's normalized hex, and only a
 * transfer whose day AND night both match the default drops the override.
 */
export const canonicalTransferColor = (
  c: DayNightColor,
  dropAt: DayNightColor,
): DayNightColor | undefined => (dayNightColorsEqual(c, dropAt) ? undefined : c);

/**
 * Fully-resolved style of one transfer: each override when present, else the
 * constant default. Structural transfer parameter so narrowed shapes pass
 * through (same convention as dotSizeOverride). `defaults` stays a parameter
 * for callers that already thread the constant explicitly (TransferLayer's
 * prop) and for tests; every production fallback is TRANSFER_STYLE_DEFAULTS.
 * Colors resolve to the theme's hex one level up (TransferLayer), via
 * `resolveDayNight` — this stays theme-agnostic.
 */
export const resolveTransferStyle = (
  t: {
    thickness?: number;
    color?: DayNightColor;
    strokeWidth?: number;
    strokeColor?: DayNightColor;
  },
  defaults: TransferStyle = TRANSFER_STYLE_DEFAULTS,
): TransferStyle => ({
  thickness: t.thickness ?? defaults.thickness,
  color: t.color ?? defaults.color,
  strokeWidth: t.strokeWidth ?? defaults.strokeWidth,
  strokeColor: t.strokeColor ?? defaults.strokeColor,
});
