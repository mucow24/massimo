import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Which library map the live document belongs to, and which version of it the
 * document came from.
 *
 * Deliberately OUTSIDE the doc, and outside `mapLibrary` itself. Outside the
 * doc because a downloaded file carries no id: loading one and saving it must
 * create a new map rather than have two files fighting over one history.
 * Outside `mapLibrary` because that module owns IndexedDB and knows nothing
 * about React — this is a two-field pointer the toolbar has to re-render on.
 *
 * `version` is what the toolbar's pill shows. It is the version the document
 * came FROM, not a claim about what is on the canvas now: edit after opening
 * v32 and you are still working from v32 until the next save mints v33.
 *
 * Both halves move together, so the two states that matter stay distinct:
 * a fresh map (`mapId` set, `version` null — nothing saved under it yet) and a
 * loaded JSON file (both null — not a library map at all).
 */
interface LibraryPointerState {
  mapId: string | null;
  version: number | null;
  setPointer: (mapId: string | null, version: number | null) => void;
}

const POINTER_KEY = 'massimo-library-pointer';
const LEGACY_KEY = 'massimo-library-current';

/**
 * #265 kept the pointer as a bare string under its own key. Read it as the
 * initial state, so an afternoon's saves don't fork a new map the first time
 * this build runs.
 *
 * The version is deliberately not guessed: nothing recorded which version that
 * document came from, and a wrong number in the toolbar is worse than none. The
 * pill stays blank until the next save says something true.
 */
const legacyMapId = localStorage.getItem(LEGACY_KEY);

export const useLibraryPointer = create<LibraryPointerState>()(
  persist(
    (set) => ({
      // Only consulted when nothing is persisted under POINTER_KEY: `persist`
      // merges the stored blob over this initial state on rehydrate.
      mapId: legacyMapId,
      version: null,
      setPointer: (mapId, version) => set({ mapId, version }),
    }),
    {
      name: POINTER_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ mapId: s.mapId, version: s.version }),
    },
  ),
);

/**
 * Finish the adoption: write the id through, and only then retire the old key.
 *
 * The order is the whole point. `persist` writes on a CHANGE and skips the
 * initial state when storage is empty, so an adopted id sits in memory and
 * nowhere else — retire the key beside it and one reload with nothing saved in
 * between loses the map for good. That failure needs a reload to show, so it
 * hides from any test that only checks the boot.
 *
 * Guarded on the adopted id having actually won the merge, so a real persisted
 * pointer is never clobbered by a legacy key that outlived it.
 */
if (legacyMapId !== null) {
  if (useLibraryPointer.getState().mapId === legacyMapId) {
    useLibraryPointer.setState({ mapId: legacyMapId });
  }
  localStorage.removeItem(LEGACY_KEY);
}
