import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';

interface SnapPrefsState {
  modes: SnapModes;
  /** Set one snap mode. Value type is the union across keys (booleans for
   *  line/equidistant/tens, the directional enums for all/grid) — the
   *  toolbar's spec table is the source of truth for which values are legal
   *  per key, so a correlated generic isn't worth the call-site casts. */
  setMode: (key: keyof SnapModes, value: SnapModes[keyof SnapModes]) => void;
}

/**
 * Upgrade a persisted v0 blob (when `all`/`grid` were booleans) to the v1
 * directional enums: `all: true → 'all'`, `grid: true → 'both'`, falsey → off.
 */
function migrateSnapPrefs(persisted: unknown): { modes: SnapModes } {
  const modes = (persisted as { modes?: Partial<Record<keyof SnapModes, unknown>> })?.modes ?? {};
  const all = modes.all;
  const grid = modes.grid;
  return {
    modes: {
      ...DEFAULT_SNAP_MODES,
      ...(modes as Partial<SnapModes>),
      all: typeof all === 'boolean' ? (all ? 'all' : 'off') : ((all as SnapModes['all']) ?? 'off'),
      grid:
        typeof grid === 'boolean'
          ? grid
            ? 'both'
            : 'off'
          : ((grid as SnapModes['grid']) ?? 'off'),
    },
  };
}

/**
 * User-toggleable snap modes. UI preference, not document state — kept in a
 * separate store so opening a different map doesn't clobber the user's snap
 * choices. Persisted to localStorage so toggles stick across reloads.
 */
export const useSnapPrefs = create<SnapPrefsState>()(
  persist(
    (set) => ({
      modes: DEFAULT_SNAP_MODES,
      setMode: (key, value) => set((s) => ({ modes: { ...s.modes, [key]: value } })),
    }),
    {
      name: 'massimo-snap-prefs-v1',
      version: 1,
      migrate: (persisted, version) =>
        version < 1 ? migrateSnapPrefs(persisted) : (persisted as { modes: SnapModes }),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ modes: s.modes }),
    },
  ),
);
