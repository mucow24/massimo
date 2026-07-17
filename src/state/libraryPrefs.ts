import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MapSort } from './mapLibrary';

interface LibraryPrefsState {
  /** How the library dialog orders its map list. What each mode means —
   *  including starred maps pinning to the top — is `sortMaps`'s business;
   *  this store only remembers the choice across sessions. */
  sort: MapSort;
  setSort: (sort: MapSort) => void;
}

/**
 * Map-library UI preferences. A view preference, not library data — kept in
 * its own persisted store (the labelEditorPrefs pattern) so it survives
 * reloads instead of resetting every time the dialog opens.
 */
export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: 'updated',
      setSort: (sort) => set({ sort }),
    }),
    {
      name: 'massimo-library-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sort: s.sort }),
    },
  ),
);
