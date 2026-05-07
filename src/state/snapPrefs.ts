import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';

interface SnapPrefsState {
  modes: SnapModes;
  setMode: (key: keyof SnapModes, value: boolean) => void;
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
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ modes: s.modes }),
    },
  ),
);
