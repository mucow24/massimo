/**
 * Where a map's per-tab state lives, and how a tab says which map it is on.
 *
 * A browser tab is ON one library map — the Google Docs model, where the URL
 * names the document. The map id rides in the URL fragment (`#map=<id>`), so
 * every tab carries its own identity: a reload keeps it, session restore
 * keeps it, a bookmark or a middle-click from the library opens the map in a
 * fresh tab, and two tabs on different maps never share a byte.
 *
 * Everything that used to sit in ONE localStorage slot for the whole app —
 * the live document, the save baseline, the camera, the version pointer —
 * is keyed by that map id instead. One slot per app was the corruption: two
 * tabs each wrote their own half of it, and the next boot assembled a
 * document from one tab and a pointer from the other, so a save wrote map A's
 * bytes into map B's history. Keyed per map there is nothing to assemble.
 *
 * Lives below every store (no imports) so each store's storage adapter can
 * build its key without a cycle.
 */

const DOC = 'massimo-doc:';
const BASELINE = 'massimo-baseline:';
const CAMERA = 'massimo-camera:';
const POINTER = 'massimo-pointer:';

/** The map's working copy — the persisted doc store blob. Present only while
 *  the map has a working copy nobody has written to the library: leaving a map
 *  clean deletes it (see saveBaseline's markSaved and Toolbar's auto-save), so
 *  the slots in use are bounded by unsaved work, not by how many maps have
 *  ever been opened in this browser. */
export const docKey = (mapId: string): string => DOC + mapId;
/** The save baseline's persisted hash + backed bit (saveBaseline.ts). */
export const baselineKey = (mapId: string): string => BASELINE + mapId;
/** The camera (x, y, zoom) — the one viewport field that is per map. */
export const cameraKey = (mapId: string): string => CAMERA + mapId;
/** The version the working copy came from (libraryPointer.ts). */
export const pointerKey = (mapId: string): string => POINTER + mapId;

/** Does this map have a working copy in this browser? */
export const hasDocDraft = (mapId: string): boolean => localStorage.getItem(docKey(mapId)) !== null;

export const removeDocDraft = (mapId: string): void => localStorage.removeItem(docKey(mapId));

/** Every map with a working copy in this browser. The library dialog crosses
 *  this with its rows: a copy whose map has no row — a New drawn and closed on
 *  — is reachable from nowhere else. */
export function listDocDrafts(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DOC)) ids.push(key.slice(DOC.length));
  }
  return ids;
}

/** The name inside a working copy, for a row that has no library row to
 *  read one from. */
export function readDocDraftName(mapId: string): string | null {
  const raw = localStorage.getItem(docKey(mapId));
  if (raw === null) return null;
  try {
    const name = (JSON.parse(raw) as { state?: { name?: unknown } }).state?.name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/** A map deleted from the library takes its slots with it — a working copy
 *  left behind would be a multi-MB orphan nothing lists. */
export function removeMapKeys(mapId: string): void {
  for (const key of [docKey, baselineKey, cameraKey, pointerKey])
    localStorage.removeItem(key(mapId));
}

/**
 * The same document under a new identity: the working copy and the camera
 * travel with it. The library-facing records (pointer version, baseline) do
 * NOT — the caller rewrites those, because retargeting is exactly the moment
 * their old values stop being true.
 */
export function moveDocKeys(from: string, to: string): void {
  for (const key of [docKey, cameraKey]) {
    const value = localStorage.getItem(key(from));
    localStorage.removeItem(key(from));
    if (value !== null) localStorage.setItem(key(to), value);
  }
}

const HASH_PREFIX = '#map=';

/** The map the URL names, or null for a bare URL. */
export function readTabMapId(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  return id === '' ? null : id;
}

/**
 * Name the map in the URL. `replaceState`, not `location.hash =`: assigning
 * the hash fires `hashchange`, which libraryPointer treats as the USER having
 * navigated (back button, edited address bar) and answers with a reload.
 */
export function writeTabMapId(mapId: string): void {
  if (readTabMapId() === mapId) return;
  window.history.replaceState(window.history.state, '', mapUrl(mapId));
}

/** The map's own URL fragment — what a link to it carries. */
export const mapUrl = (mapId: string): string => HASH_PREFIX + encodeURIComponent(mapId);

// The pre-per-map keys, adopted once (below) and then retired.
const LEGACY_DOC = 'vignelli-map-doc-v1';
const LEGACY_POINTER = 'massimo-library-pointer';
const LEGACY_BASELINE = 'massimo-save-baseline';
/** Still the global preferences key — only its camera fields move out. */
export const VIEWPORT_PREFS_KEY = 'massimo-viewport';

/**
 * Move a pre-per-map browser's single working copy into its map's own slots.
 *
 * Runs before the stores hydrate, once: the legacy keys are removed as they are
 * adopted, so a later boot finds nothing to do. The document goes under the id
 * the legacy pointer named (a loaded file, which had none, gets a fresh one —
 * `mint`), together with its version, baseline record and camera. The camera
 * fields are lifted OUT of the viewport blob; the rest of that blob is the
 * view preferences, which stay global and stay where they are.
 *
 * Returns the adopted map so the caller can make this tab that map — whatever
 * the URL says: the legacy document belongs to the map the pointer named, and
 * a tab that opened a bookmarked URL on the very first boot of this build
 * still has to bring that document along rather than strand it.
 */
export function adoptLegacyStorage(
  mint: () => string,
): { mapId: string; version: number | null } | null {
  const doc = localStorage.getItem(LEGACY_DOC);
  const pointerRaw = localStorage.getItem(LEGACY_POINTER);
  if (doc === null && pointerRaw === null) return null;

  let mapId: string | null = null;
  let version: number | null = null;
  if (pointerRaw !== null) {
    try {
      const state = (JSON.parse(pointerRaw) as { state?: { mapId?: unknown; version?: unknown } })
        .state;
      if (typeof state?.mapId === 'string') mapId = state.mapId;
      if (typeof state?.version === 'number') version = state.version;
    } catch {
      // Unreadable: the document still deserves an identity of its own.
    }
  }
  mapId ??= mint();

  if (doc !== null) localStorage.setItem(docKey(mapId), doc);
  localStorage.setItem(pointerKey(mapId), JSON.stringify({ state: { version }, version: 0 }));
  const baseline = localStorage.getItem(LEGACY_BASELINE);
  if (baseline !== null) localStorage.setItem(baselineKey(mapId), baseline);

  const prefsRaw = localStorage.getItem(VIEWPORT_PREFS_KEY);
  if (prefsRaw !== null) {
    try {
      const blob = JSON.parse(prefsRaw) as { state?: Record<string, unknown>; version?: number };
      const { x, y, zoom, ...prefs } = blob.state ?? {};
      if (typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number') {
        localStorage.setItem(
          cameraKey(mapId),
          JSON.stringify({ state: { x, y, zoom }, version: blob.version ?? 0 }),
        );
      }
      localStorage.setItem(VIEWPORT_PREFS_KEY, JSON.stringify({ ...blob, state: prefs }));
    } catch {
      // Not ours to repair; the viewport store heals what it reads.
    }
  }

  localStorage.removeItem(LEGACY_DOC);
  localStorage.removeItem(LEGACY_POINTER);
  localStorage.removeItem(LEGACY_BASELINE);
  return { mapId, version };
}
