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
