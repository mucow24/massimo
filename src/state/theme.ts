import { useMemo } from 'react';
import { useViewportStore } from './viewportStore';

/**
 * Theming has two halves, split by what can consume CSS:
 *
 *   - **Chrome** (toolbar, sidebar, menus, popovers, inputs) is themed purely
 *     in CSS via the `data-theme="dark"` attribute on the `.app` root (set in
 *     App.tsx) plus the `--ui-label-color` custom property. No JS needed.
 *
 *   - **Canvas** (the SVG map) can't lean on CSS for most of its paint: stroke
 *     colors baked into `<defs>` patterns, attribute-level `fill`/`stroke`, and
 *     inline-styled `<foreignObject>` editors don't inherit CSS variables
 *     cleanly. Those colors come from here instead — one palette per mode,
 *     resolved in React and passed down as props.
 *
 * Keeping every canvas-side literal in this one table (rather than scattered
 * `darkMode ? … : …` ternaries across a dozen components) means the palette is
 * the single place to read or tweak the map's colors.
 */
export interface ThemeColors {
  /** SVG canvas background rect. */
  canvasBg: string;
  /** Station names + free text labels painted on the canvas. */
  label: string;
  /** Outline stroke around a selected station's selection highlight. */
  selectionStroke: string;
  /** Background grid lines. */
  grid: string;
  /**
   * Opaque "off"-position fill for dashed/hatched line styles (the dashed
   * underlay stroke and the hatch-tile gap). Matches the canvas so the gaps
   * read as empty map, not a stale white showing lines behind.
   */
  underlay: string;
  /** On-canvas station rename editor (inline-styled `<textarea>`). */
  editorBg: string;
  editorText: string;
  /**
   * Fill for an empty station's phantom dot — the lone marker anchoring a
   * station that has no lines yet. Flips with the theme so it stays visible
   * against the canvas (black on light, white on dark).
   */
  phantomDot: string;
}

const LIGHT: ThemeColors = {
  canvasBg: '#fafafa',
  label: '#111111',
  selectionStroke: '#000000',
  grid: '#eeeeee',
  underlay: '#ffffff',
  editorBg: '#ffffff',
  editorText: '#111111',
  phantomDot: '#000000',
};

const DARK: ThemeColors = {
  canvasBg: '#000000',
  label: '#ffffff',
  selectionStroke: '#ffffff',
  grid: '#222222',
  underlay: '#000000',
  editorBg: '#000000',
  editorText: '#ffffff',
  phantomDot: '#ffffff',
};

/** Pure mode → palette mapping. Exported for unit tests and non-React callers. */
export function themeColors(darkMode: boolean): ThemeColors {
  return darkMode ? DARK : LIGHT;
}

/** Canvas-side color palette for the active theme. */
export function useThemeColors(): ThemeColors {
  const darkMode = useViewportStore((s) => s.darkMode);
  return useMemo(() => themeColors(darkMode), [darkMode]);
}
