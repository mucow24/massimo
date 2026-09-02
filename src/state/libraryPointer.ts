import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { newMapId } from './mapLibrary';
import { adoptLegacyStorage, pointerKey, readTabMapId, writeTabMapId } from './mapKeys';

/**
 * Which library map this TAB is on, and which version of it the document
 * came from.
 *
 * The map id is the tab's identity — it rides in the URL (`#map=<id>`, see
 * mapKeys.ts), and every per-map storage adapter (the doc, the baseline, the
 * camera, this store's own version) builds its key from it. Deliberately
 * OUTSIDE the doc: a downloaded file carries no id, so loading one mints a
 * fresh identity and saving it makes a new map rather than two files fighting
 * over one history. Outside `mapLibrary` because that module owns IndexedDB
 * and knows nothing about React; this is a two-field pointer the toolbar
 * re-renders on.
 *
 * `mapId` is never null: a tab is always on SOME map. A bare URL mints one (an
 * empty New map, its id in the URL from then on), and a loaded file gets one
 * too. Where the old design distinguished "a fresh map" from "a loaded file"
 * by a null id, both are now simply a map with no version yet.
 *
 * `version` is what the toolbar's pill shows. It is the version the document
 * came FROM, not a claim about what is on the canvas now: edit after opening
 * v32 and you are still working from v32 until the next save mints v33. It is
 * persisted per map, so two tabs' pills never read each other's number.
 */
interface LibraryPointerState {
  mapId: string;
  version: number | null;
  setPointer: (mapId: string, version: number | null) => void;
}

// The first boot of this build on a browser that kept ONE working copy for
// the whole app: that document goes under its map's own slots, and this tab
// becomes that map — whatever the URL says, because the document belongs to
// the map the old pointer named and must not be stranded behind a bookmark.
const legacy = adoptLegacyStorage(newMapId);
const urlMapId = readTabMapId();

/**
 * True when this boot named no map at all — a bare URL with nothing to adopt.
 * The app answers with the library open over an empty canvas, the way a
 * documents app opens on its list. Read by main.tsx, never acted on here: a
 * unit-test render must not open a dialog because jsdom has no hash.
 */
export const bootedWithoutMap = urlMapId === null && legacy === null;

// The id every per-map adapter keys by. A module variable rather than a store
// read because this store's OWN storage adapter runs during `create`, before
// the store exists to be read; the subscription below keeps it current.
let currentMapId: string = legacy?.mapId ?? urlMapId ?? newMapId();

/** The map this tab is on — the id every per-map storage key is built from. */
export const tabMapId = (): string => currentMapId;

type PersistedPointer = { version: number | null };

const readStored = (mapId: string): StorageValue<PersistedPointer> | null => {
  const raw = localStorage.getItem(pointerKey(mapId));
  try {
    return raw ? (JSON.parse(raw) as StorageValue<PersistedPointer>) : null;
  } catch {
    return null;
  }
};

/** The version a map's working copy came from, as its slot records it — read
 *  for a map this tab is about to become (mapTab.ts), BEFORE the pointer
 *  moves there, since moving it writes the slot. */
export const storedPointerVersion = (mapId: string): number | null => {
  const v = readStored(mapId)?.state.version;
  return typeof v === 'number' ? v : null;
};

const pointerStorage: PersistStorage<PersistedPointer> = {
  getItem: () => readStored(currentMapId),
  setItem: (_name, value) => localStorage.setItem(pointerKey(currentMapId), JSON.stringify(value)),
  removeItem: () => localStorage.removeItem(pointerKey(currentMapId)),
};

export const useLibraryPointer = create<LibraryPointerState>()(
  persist(
    (set) => ({
      mapId: currentMapId,
      version: null,
      setPointer: (mapId, version) => set({ mapId, version }),
    }),
    {
      name: 'massimo-pointer',
      storage: pointerStorage,
      // The id is the KEY, never the value: a blob that carried an id could be
      // read back under another map's key and point it somewhere else — the
      // very cross-tab mix-up per-map keys exist to end.
      partialize: (s) => ({ version: s.version }),
    },
  ),
);

// Keep the key source and the URL in step with the store, whichever door
// wrote it (setPointer, a test's setState, a rehydrate). Runs inside the set,
// before persist's own write — so the version lands under the NEW map's key.
useLibraryPointer.subscribe((s) => {
  currentMapId = s.mapId;
  writeTabMapId(s.mapId);
});
// A bare URL names its (minted or adopted) map from here on: a reload must
// come back to the same document.
writeTabMapId(currentMapId);

/**
 * Has the URL stopped naming this tab's map? Only the USER can make that so
 * (back/forward, an edited address bar) — the app writes the fragment with
 * replaceState, which fires no event. The answer is a reload: the tab reboots
 * as the map the URL now names, and the working copy it was on stays in its
 * own slot for whichever tab comes back to it.
 */
export const tabHashDiverged = (): boolean => readTabMapId() !== currentMapId;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (tabHashDiverged()) window.location.reload();
  });
}
