import { useMemo } from 'react';
import { useDoc } from './store';
import { useViewportStore, type DayCanvasColor } from './viewportStore';

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
   * Editor guide geometry — the line-circle's dashed ring. Stronger than
   * `grid` (a guide is an object you grab and bind stations to, not wallpaper)
   * but clearly not map ink.
   */
  guide: string;
  /**
   * Alignment guides (the h/v snap lines) — their own slot rather than
   * `guide`: rings sit UNDER stations they carry and want to whisper, but an
   * alignment guide's whole job is to be seen and snapped against, and the
   * ring grey was invisible over a busy map. Indigo: unmistakably editor ink,
   * clearly apart from the interaction accent so a SELECTED guide still
   * reads. Night is the same hue lifted for the black canvas.
   */
  alignGuide: string;
  /** A selected alignment guide's restroke. Complementary amber — the base is
   *  blue and the accent is blue, so "chosen" needs to leave the family. */
  alignGuideSelected: string;
  /** The mouseover restroke — the standard half-way-to-selected affordance,
   *  spelled as its own (softened-amber) value because the guide restrokes
   *  directly rather than compositing a half-opacity overlay. */
  alignGuideHover: string;
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
  guide: '#b5b5b5',
  alignGuide: '#2f439b',
  alignGuideSelected: '#e07a1f',
  alignGuideHover: '#f0a76a',
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
  guide: '#5a5a5a',
  alignGuide: '#8c9cf2',
  alignGuideSelected: '#ffb066',
  alignGuideHover: '#c98a45',
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

/**
 * Day mode with the paper dimmed — the "reduce glare without going to night
 * mode" preference. Day-mode ink, underlay and editor stay put, so it reads as
 * day mode with the lights down, not night. 'gray' (#616161, Material Grey
 * 700) is the middle rung between white and black.
 *
 * The grid is the one exception to "only the paper moves": the day grid is
 * tuned to whisper against near-white, so on a dimmed paper it reads as a cage
 * of bright white lines. Gray drops it to Grey 800, one rung below its paper;
 * black shares DARK's canvas, so it takes DARK's grid — referenced, not
 * copied, so the two can't drift apart.
 *
 * What licenses that exception is EXPORT REACH, not taste. `canvasBg` is
 * stripped as `data-bg` and the grid renders inside a `data-export-exclude`
 * subtree, so both are screen-only and free to follow a local viewing
 * preference. `underlay` is not: it is real map paint (dash gaps, hollow
 * bullets), so dimming it here would bake one machine's glare setting into
 * every SVG/PNG/PDF. Same "it should match the paper" argument, opposite
 * answer — check which side of the export door a field sits on before adding
 * to this list. Each entry is a frozen constant so themeColors stays
 * referentially stable per input.
 */
const DAY_PAPER: Record<DayCanvasColor, ThemeColors> = {
  white: LIGHT,
  gray: { ...LIGHT, canvasBg: '#616161', grid: '#424242' },
  black: { ...LIGHT, canvasBg: DARK.canvasBg, grid: DARK.grid },
};

/**
 * Pure mode → palette mapping. Exported for unit tests and non-React callers.
 * `dayCanvasColor` (a local viewing preference) only affects day mode; night
 * mode is always black, so the argument is ignored there. Falls back to the
 * plain day palette if a stale/unknown value ever reaches here from storage.
 */
export function themeColors(
  darkMode: boolean,
  dayCanvasColor: DayCanvasColor = 'white',
): ThemeColors {
  if (darkMode) return DARK;
  return DAY_PAPER[dayCanvasColor] ?? LIGHT;
}

/** Canvas-side color palette for the active theme. The document's `darkMode`
 *  picks day vs night (so loading a night map paints night with no extra
 *  wiring); the local `dayCanvasColor` preference then dims the day paper. */
export function useThemeColors(): ThemeColors {
  const darkMode = useDoc((s) => s.darkMode);
  const dayCanvasColor = useViewportStore((s) => s.dayCanvasColor);
  return useMemo(() => themeColors(darkMode, dayCanvasColor), [darkMode, dayCanvasColor]);
}
