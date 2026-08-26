import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isMapSort, type MapSort } from './mapLibrary';
import { healPersistedUnion } from './persistedUnion';

/** The order a fresh boot opens the library on, and what a stored non-member
 *  heals to: what you were last working on, first. */
const DEFAULT_MAP_SORT: MapSort = 'updated';

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
      sort: DEFAULT_MAP_SORT,
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
      // zustand's shallow merge, plus the gate on the one stored UNION here
      // (see healPersistedUnion). A mode MAP_SORTS no longer offers leaves the
      // picker's Radix trigger with nothing to render while `sortMaps` falls
      // through to newest-edited — the control blank and the list ordered by
      // something it never said. The two star filters need no gate: each is
      // read as a boolean.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<LibraryPrefsState>;
        return {
          ...current,
          ...stored,
          sort: healPersistedUnion(stored.sort, current.sort, isMapSort, DEFAULT_MAP_SORT),
        };
      },
    },
  ),
);
