import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * The alignment guides' ink recipe, as live dials rather than constants.
 *
 * Every number here was dialed in by eye against a dense map, and the eye needs
 * them back whenever the map (or the paper under it) changes — so they sit in a
 * store the toolbar's Developer pane writes, instead of buried in GuideView. It
 * is session state, not document data: nothing about how thick a guide draws
 * belongs in a saved file, and it never reaches an export (guides are
 * export-excluded to begin with).
 */
export interface GuideRenderSettings {
  /** Overrides `theme.alignGuide`, the idle stroke; null follows the theme. */
  color: string | null;
  /** Overrides the paper-toned casing (`theme.canvasBg`); null follows it. */
  casingColor: string | null;
  /** SVG dasharray in recipe px, held exactly as typed — "5 2". */
  dash: string;
  /** Core stroke width in recipe px. */
  thickness: number;
  /** The screen-px floor the whole recipe scales down to when zoomed out. */
  minThickness: number;
  /** The zoom, as a percentage, where sizing flips from canvas-relative
   *  (riding the map below it) to screen-constant (above). */
  transitionZoomPercent: number;
}

export const DEFAULT_GUIDE_RENDER: GuideRenderSettings = {
  color: null,
  casingColor: null,
  dash: '5 2',
  thickness: 1.5,
  minThickness: 0.5,
  transitionZoomPercent: 200,
};

const DEFAULT_DASH: readonly number[] = [5, 2];

/**
 * The dash text as a list of recipe-px lengths. Falls back to the default
 * pattern for anything unusable — the field holds whatever is typed, and half
 * of "5 2" is not a pattern, so mid-edit text must not blank the guides off the
 * canvas. All-zero counts as unusable for the same reason: it draws nothing.
 */
export function parseDashPattern(text: string): number[] {
  const parts = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const usable =
    parts.length > 0 &&
    parts.every((n) => Number.isFinite(n) && n >= 0) &&
    parts.some((n) => n > 0);
  return usable ? parts : [...DEFAULT_DASH];
}

/** A pattern's repeat length — what the dash phase is anchored modulo. SVG runs
 *  an ODD-length list twice before it repeats, so that period is double. */
export function dashPeriod(dash: readonly number[]): number {
  const sum = dash.reduce((a, b) => a + b, 0);
  return dash.length % 2 === 1 ? sum * 2 : sum;
}

interface DevSettingsState {
  guide: GuideRenderSettings;
  setGuide: (patch: Partial<GuideRenderSettings>) => void;
  resetGuide: () => void;
}

/**
 * Developer-pane state. Persisted, because tuning a dial means looking at the
 * map, reloading, and looking again — but merged over the defaults on rehydrate
 * so a stored recipe missing a dial (these come and go) can't feed `undefined`
 * into the ink math.
 */
export const useDevSettings = create<DevSettingsState>()(
  persist(
    (set) => ({
      guide: DEFAULT_GUIDE_RENDER,
      setGuide: (patch) => set((s) => ({ guide: { ...s.guide, ...patch } })),
      resetGuide: () => set({ guide: DEFAULT_GUIDE_RENDER }),
    }),
    {
      name: 'massimo-dev-settings',
      storage: createJSONStorage(() => localStorage),
      // The full six-field snapshot persists after any dial turn (Reset
      // re-snapshots too), so a later change to DEFAULT_GUIDE_RENDER is
      // shadowed by the stored copy until the next Reset. Accepted: the
      // endgame of tuning here is baking new constants, at which point the
      // dials go back to following them.
      partialize: (s) => ({ guide: s.guide }),
      merge: (persisted, current) => ({
        ...current,
        guide: {
          ...DEFAULT_GUIDE_RENDER,
          ...(persisted as { guide?: Partial<GuideRenderSettings> } | undefined)?.guide,
        },
      }),
    },
  ),
);
