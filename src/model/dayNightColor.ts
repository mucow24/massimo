import type { DayNightColor } from './types';

// Pure operations on a theme-aware color (a `{ day, night }` pair). The single
// owner every day/night resolver and equality goes through — a dot fill, a
// transfer color, a style-def comparison all read the same two rules here
// rather than each spelling out the `darkMode ? night : day` ternary.

// Resolve a theme-aware color to the concrete hex for the active theme: the
// night half in dark mode, the day half otherwise.
export const resolveDayNight = (c: DayNightColor, darkMode: boolean): string =>
  darkMode ? c.night : c.day;

// Structural equality for a theme-aware color: both halves must match. The
// `===` of the day/night world, used wherever a theme-aware override is dropped
// at a default.
export const dayNightColorsEqual = (a: DayNightColor, b: DayNightColor): boolean =>
  a.day === b.day && a.night === b.night;

/**
 * Equality for a color slot that holds EITHER a string sentinel ('line', 'bw',
 * 'none') or a day/night pair: a sentinel matches only the identical sentinel,
 * and two pairs compare structurally. Every such slot — a dot's fill, stroke
 * and service code, a line's casing — reads this one rule, so none of them can
 * drift into comparing pairs by reference.
 */
export const sentinelOrDayNightEqual = <T extends DayNightColor | string>(a: T, b: T): boolean =>
  typeof a === 'string' || typeof b === 'string' ? a === b : dayNightColorsEqual(a, b);
