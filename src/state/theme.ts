import { useMemo } from 'react';
import { useDoc } from './store';

/**
 * Theming has two halves, split by what can consume CSS:
 *
 *   - **Chrome** (toolbar, sidebar, menus, popovers, inputs) is themed purely
 *     in CSS: the design tokens declared on `.app` in styles.css are
 *     reassigned once under the `data-theme="dark"` attribute (set in
 *     App.tsx). No JS needed.
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
   * underlay stroke and the hatch-tile gap), and the interior of unfilled
   * inline route bullets. Matches the canvas so the gaps read as empty map,
   * not a stale white showing lines behind.
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
  /**
   * The editor's interaction accent: rect-select marquee, StopGrid drop
   * targets, placement-mode frames, the inline rename border, selection
   * washes, snap guides. Brightened in dark mode — the light blue is
   * near-invisible on the black canvas. The chrome side reads the same
   * values via the `--accent` CSS variables declared on `.app` in styles.css.
   */
  accent: string;
  /** Translucent fill companion to `accent` (marquee interior). */
  accentWash: string;
  /**
   * Full-canvas focus wash: painted under a selected line's — or a
   * layout-edited station's — re-painted copy, muting everything else. One
   * standardized strength across both themes (a softer light-mode wash was
   * tried and disliked); tune it here and every focus mode follows.
   */
  dim: string;
  dimOpacity: number;
  /**
   * Station names surfaced above the dim as "addable" hints in append mode —
   * tuned to stay subordinate-but-legible against the dimmed backdrop each
   * mode produces.
   */
  dimmedLabel: string;
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
  accent: '#1a4ea8',
  accentWash: 'rgba(26, 78, 168, 0.08)',
  dim: '#000000',
  dimOpacity: 0.7,
  dimmedLabel: '#eeeeee',
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
  accent: '#6b9aff',
  accentWash: 'rgba(107, 154, 255, 0.12)',
  dim: '#000000',
  dimOpacity: 0.7,
  dimmedLabel: '#bbbbbb',
};

/** Pure mode → palette mapping. Exported for unit tests and non-React callers. */
export function themeColors(darkMode: boolean): ThemeColors {
  return darkMode ? DARK : LIGHT;
}

/** Canvas-side color palette for the active theme (see MapDoc.darkMode — the
 *  document decides, so loading a night map paints night with no extra wiring). */
export function useThemeColors(): ThemeColors {
  const darkMode = useDoc((s) => s.darkMode);
  return useMemo(() => themeColors(darkMode), [darkMode]);
}
