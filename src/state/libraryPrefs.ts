import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MapSort } from './mapLibrary';

interface LibraryPrefsState {
  /** How the library dialog orders its map list. What each mode means is
   *  `sortMaps`'s business; this store only remembers the choice across
   *  sessions. */
  sort: MapSort;
  setSort: (sort: MapSort) => void;
  /** Whether the map list is showing only starred maps. */
  starredMapsOnly: boolean;
  setStarredMapsOnly: (on: boolean) => void;
  /** The same filter over the version list. Its own flag, not the map one: the
   *  two columns answer different questions, and pinning them together would
   *  hide a map's whole history the moment you went looking for a starred
   *  map. */
  starredVersionsOnly: boolean;
  setStarredVersionsOnly: (on: boolean) => void;
}

/**
 * Map-library UI preferences. View preferences, not library data — kept in
 * their own persisted store (the labelEditorPrefs pattern) so they survive
 * reloads instead of resetting every time the dialog opens.
 */
export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: 'updated',
      setSort: (sort) => set({ sort }),
      starredMapsOnly: false,
      setStarredMapsOnly: (starredMapsOnly) => set({ starredMapsOnly }),
      starredVersionsOnly: false,
      setStarredVersionsOnly: (starredVersionsOnly) => set({ starredVersionsOnly }),
    }),
    {
      name: 'massimo-library-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sort: s.sort,
        starredMapsOnly: s.starredMapsOnly,
        starredVersionsOnly: s.starredVersionsOnly,
      }),
    },
  ),
);
