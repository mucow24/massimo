/**
 * The map library: versions of saved maps, in IndexedDB.
 *
 * This module knows NOTHING about `MapDoc`. It stores opaque strings — a row
 * IS a file, byte-for-byte what `serialize()` produced — so `parse()` remains
 * the single ingestion path that owns migration. Storing the structured object
 * instead would be one keystroke away (IndexedDB structured-clones happily) and
 * would bypass the version envelope; don't.
 *
 * Keyed by a minted library id, never by name: two maps may share a name, and
 * a rename must not orphan history.
 *
 * Two unrelated things are called "version" around here. A row's `version` is
 * the user-facing handle — the v32 in the toolbar. The DOC's version is the
 * schema stamp inside the payload string, which belongs to `serialize`/`parse`
 * and which this module never reads. `DB_SCHEMA_VERSION` is a third, private to
 * the upgrade path below. Only the first is a library concept.
 */

const DB_NAME = 'massimo-library';
/** IndexedDB's own schema stamp — NOT a map's version number. v1 shipped in #265. */
const DB_SCHEMA_VERSION = 3;

/**
 * Auto versions kept per map. Explicit saves are never pruned, however many
 * there are, and neither is anything you starred or named — see `isPrunable`.
 */
export const AUTO_VERSION_LIMIT = 50;

/**
 * How far back a map row looks for a thumbnail. A save can legitimately have
 * none (empty canvas, or a rasterization failure), and a blank row would
 * throw away one of the only two things telling same-named maps apart.
 */
const THUMB_WALK_BACK = 5;

export type VersionSource = 'user' | 'auto';

export interface MapSummary {
  id: string;
  name: string;
  updatedAt: number;
  /** When the map's first version was saved (backfilled for older libraries). */
  createdAt: number;
  versionCount: number;
  /** Present only when starred — the same contract as a version's star. */
  starred?: true;
  thumb?: string;
}

// Every way the library list can be ordered, in the order the sort picker
// offers them. A star never enters into it. Same contract as the model's other
// ladders (ROUTE_BULLET_SHAPES, DOT_BASE_SHAPES): the picker takes its set from
// here and the gate below judges by it, so a mode can't be sortable-but-
// unpickable — or, worse, a persisted pref the guard rejects on next boot.
export const MAP_SORTS = ['updated', 'created', 'name'] as const;
/** How the library list is ordered. A star never enters into it. */
export type MapSort = (typeof MAP_SORTS)[number];

/** Is `v` one of the known sort modes? The gate the picker's value judges by,
 *  and the one a rehydrating pref heals against — hence `unknown`: a stored
 *  blob can hand over a number, a null or an object, not just a wrong string. */
export const isMapSort = (v: unknown): v is MapSort =>
  (MAP_SORTS as readonly unknown[]).includes(v);

export interface VersionMeta {
  id: number;
  mapId: string;
  savedAt: number;
  source: VersionSource;
  /** The user-facing handle: 1-based, per map, and never reused. */
  version: number;
  /** An optional label ("beta 1 — needs work"). Absent, never blank. */
  name?: string;
  /** Present only when starred, so the flag reads as an act, not a default. */
  starred?: true;
  thumb?: string;
}

/** What a save hands back: the storage key, and the number to show for it. */
export interface SavedVersion {
  id: number;
  version: number;
}

interface MapRow {
  id: string;
  name: string;
  updatedAt: number;
  /** Stamped at the map's first save; the v3 upgrade backfills older rows. */
  createdAt: number;
  /** Present only when starred, so the flag reads as an act, not a default. */
  starred?: true;
  /**
   * The next version number to hand out. It only ever climbs — which is the
   * whole point. Deriving the number instead (`max(version) + 1`, or a count)
   * would re-issue v3 after v3 is deleted, or renumber the map's whole history
   * the first time the prune policy runs, and a version number that moves is
   * no use as a handle.
   */
  nextVersion: number;
}

/** A map row as the v2 schema wrote it — `createdAt` not yet stamped. */
type MapRowV2 = Omit<MapRow, 'createdAt'> & { createdAt?: number };

interface PayloadRow {
  id: number;
  json: string;
}

/** The v1 row shape (store `revisions`), read only by the v1 → v2 upgrade. */
interface LegacyRevisionRow {
  id: number;
  mapId: string;
  savedAt: number;
  source: VersionSource;
  thumb?: string;
}

// Payloads live in their own store so listing never drags 256 KB of JSON per
// map through a structured clone.
const STORES = ['maps', 'versions', 'payloads'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function createVersionsStore(db: IDBDatabase): IDBObjectStore {
  const store = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
  store.createIndex('mapId', 'mapId', { unique: false });
  return store;
}

/**
 * v1 → v2: rename `revisions` to `versions` and backfill the numbering it
 * never had — `version` per row, and the map row's `nextVersion` counter.
 * It already reads every row and rewrites every map, so the v3 `createdAt`
 * stamp rides along here too and a v1 library upgrades straight through.
 *
 * Every row is carried across WITH ITS ORIGINAL ID. Payload rows are keyed by
 * that id, so re-adding rows and letting the new store's generator mint fresh
 * ones would orphan every payload in the library: each map would still list its
 * whole history, and every entry in it would fail to open. Passing the id back
 * through an autoIncrement store also drags the generator up past it, so the
 * first save after the upgrade cannot collide with a row it inherited.
 */
function upgradeV1ToV2(db: IDBDatabase, tx: IDBTransaction): void {
  const versions = createVersionsStore(db);
  const maps = tx.objectStore('maps');
  const oldRowsReq = tx.objectStore('revisions').getAll();
  oldRowsReq.onsuccess = () => {
    // The v1 id autoIncremented once per save, so id order IS chronological —
    // and it stays total where two saves shared a millisecond, which savedAt
    // does not.
    const rows = (oldRowsReq.result as LegacyRevisionRow[]).sort((a, b) => a.id - b.id);
    const counts = new Map<string, number>();
    const firstSavedAt = new Map<string, number>();
    for (const row of rows) {
      const version = (counts.get(row.mapId) ?? 0) + 1;
      counts.set(row.mapId, version);
      if (!firstSavedAt.has(row.mapId)) firstSavedAt.set(row.mapId, row.savedAt);
      versions.add({ ...row, version });
    }
    // Read the map rows only once the counts are final, and write each exactly
    // once: a map with no versions still needs a counter, and racing a
    // per-map put against a sweep for the stragglers would clobber it back to 1.
    const mapsReq = maps.getAll();
    mapsReq.onsuccess = () => {
      for (const row of mapsReq.result as MapRow[]) {
        maps.put({
          ...row,
          nextVersion: (counts.get(row.id) ?? 0) + 1,
          createdAt: firstSavedAt.get(row.id) ?? row.updatedAt,
        });
      }
      db.deleteObjectStore('revisions');
    };
  };
}

/**
 * v2 → v3: stamp `createdAt` on every map row. The truest surviving signal is
 * the earliest version's savedAt — pruning may have taken older autos, so this
 * is the best approximation left; a map with no versions at all falls back to
 * its updatedAt.
 */
function backfillCreatedAt(tx: IDBTransaction): void {
  const versionsReq = tx.objectStore('versions').getAll();
  versionsReq.onsuccess = () => {
    const earliest = new Map<string, number>();
    for (const row of versionsReq.result as VersionMeta[]) {
      const prev = earliest.get(row.mapId);
      if (prev === undefined || row.savedAt < prev) earliest.set(row.mapId, row.savedAt);
    }
    const maps = tx.objectStore('maps');
    const mapsReq = maps.getAll();
    mapsReq.onsuccess = () => {
      for (const row of mapsReq.result as MapRowV2[]) {
        maps.put({ ...row, createdAt: row.createdAt ?? earliest.get(row.id) ?? row.updatedAt });
      }
    };
  };
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_SCHEMA_VERSION);
    /**
     * Another connection is still holding an older schema open, so the upgrade
     * cannot start. Every tab running this module closes on `versionchange`
     * (see below), so this is the case where that never ran — a frozen or
     * back/forward-cached page.
     *
     * Worth handling only as of v2: v1 was the schema at creation, so no open
     * request ever had an upgrade to be blocked on, and `blocked` was
     * unreachable. Without this the request settles NEITHER way and every save
     * waits on a promise that will never resolve — a silently dead Save menu
     * rather than a message. Rejecting frees the caller to show one, and
     * `dbPromise` is nulled below so a retry re-opens once the other tab goes.
     */
    let abandoned = false;
    req.onblocked = () => {
      abandoned = true;
      reject(new Error('The map library is open in another tab. Close it and try again.'));
    };
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('maps', { keyPath: 'id' });
        createVersionsStore(db);
        db.createObjectStore('payloads', { keyPath: 'id' });
        return;
      }
      // `req.transaction` is the versionchange transaction, and it is the only
      // handle from which the retiring store can still be read. The v1 path
      // stamps createdAt itself (it rewrites every map row anyway), so the v3
      // backfill runs only for a database that is exactly v2.
      if (event.oldVersion < 2) upgradeV1ToV2(db, req.transaction!);
      else if (event.oldVersion < 3) backfillCreatedAt(req.transaction!);
    };
    req.onsuccess = () => {
      const db = req.result;
      // A blocked request still completes if the other tab eventually goes away
      // — but we already rejected, so this handle is one nobody holds and
      // nobody closes, and an open connection is precisely what blocks the NEXT
      // upgrade. Close it and let the caller's retry open its own.
      if (abandoned) {
        db.close();
        return;
      }
      // Without this, a version bump in another tab parks on `blocked` forever
      // behind our cached handle.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((err: unknown) => {
    dbPromise = null; // let a later call retry rather than cache the failure
    throw err;
  });
  return dbPromise;
}

/** Settle on a single read request. Safe only where there is nothing to commit. */
function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Settle on the TRANSACTION, never on a request.
 *
 * A request's `onsuccess` is where the interesting values appear (an
 * autoIncrement id, say) and so is exactly where one reaches for `resolve` —
 * but the transaction has not committed there. A later abort (quota, version
 * change) would then have already been reported as success, and a caller that
 * wipes the document on a successful save would wipe it against a version
 * that does not exist.
 */
function txDone<T>(tx: IDBTransaction, result: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(result());
    // An explicit abort() leaves tx.error null, so carry a message of our own.
    tx.onabort = () => reject(tx.error ?? new Error('The map library write was rolled back.'));
    tx.onerror = () => reject(tx.error ?? new Error('The map library write failed.'));
  });
}

/**
 * Whether the prune policy may take this row.
 *
 * An explicit save, a star and a name are all the same act — "keep this" — so
 * none of them is prunable. Deleting a version someone starred, or typed
 * "beta 1 — needs work" onto, is the silent loss of precisely the thing they
 * marked, which is worse than keeping a few rows too many.
 */
const isPrunable = (v: VersionMeta): boolean => v.source === 'auto' && !v.starred && !v.name;

/**
 * Drop the oldest prunable versions past the cap, with their payloads, inside
 * the caller's transaction.
 *
 * The cap counts only the rows policy may actually take, so protected versions
 * never eat the budget — you keep a full 50 autos either way.
 *
 * This reads the map's rows rather than counting them, because the predicate
 * lives in the values. Thumbs ride along on those rows, so a save drags its own
 * map's thumbnails through one clone; that is noise beside the rasterize and
 * 256 KB serialize the same save already paid for. If it ever stops being
 * noise, thumbs split into their own store exactly as payloads did.
 */
function pruneWithin(tx: IDBTransaction, mapId: string): void {
  const versions = tx.objectStore('versions');
  const payloads = tx.objectStore('payloads');
  const rowsReq = versions.index('mapId').getAll(IDBKeyRange.only(mapId));
  rowsReq.onsuccess = () => {
    // For a single mapId, index order is primary-key order and the key
    // autoIncrements — so this is oldest-first, and the excess is the head.
    const prunable = (rowsReq.result as VersionMeta[]).filter(isPrunable);
    const excess = prunable.length - AUTO_VERSION_LIMIT;
    if (excess <= 0) return; // NOT slice(0, excess): a negative end trims the TAIL
    for (const row of prunable.slice(0, excess)) {
      versions.delete(row.id);
      payloads.delete(row.id);
    }
  };
}

/**
 * Write a version of `json` under `mapId`, upserting the map row's name and
 * timestamp. Resolves with the new version's id and number once the transaction
 * commits. Rejects — and writes nothing — on any storage failure.
 */
export async function saveVersion(
  mapId: string,
  name: string,
  json: string,
  source: VersionSource,
  thumb?: string,
): Promise<SavedVersion> {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  const now = Date.now();
  const saved: SavedVersion = { id: 0, version: 0 };

  const maps = tx.objectStore('maps');
  const mapReq = maps.get(mapId);
  mapReq.onsuccess = () => {
    const prev = mapReq.result as MapRow | undefined;
    const version = prev?.nextVersion ?? 1;
    // `put` is an upsert: the first save creates the row (stamping its
    // creation time), later ones refresh name/updatedAt — spreading `prev`
    // first so the star and createdAt ride across rather than being shed.
    maps.put({
      ...prev,
      id: mapId,
      name,
      updatedAt: now,
      createdAt: prev?.createdAt ?? now,
      nextVersion: version + 1,
    } satisfies MapRow);
    const addReq = tx.objectStore('versions').add({ mapId, savedAt: now, source, version, thumb });
    addReq.onsuccess = () => {
      saved.id = addReq.result as number;
      saved.version = version;
      tx.objectStore('payloads').put({ id: saved.id, json } satisfies PayloadRow);
      pruneWithin(tx, mapId);
    };
  };

  return txDone(tx, () => saved);
}

/** Every map, newest-touched first. */
export async function listMaps(): Promise<MapSummary[]> {
  const db = await openDb();
  const rows = await reqDone<MapRow[]>(
    db.transaction('maps', 'readonly').objectStore('maps').getAll(),
  );
  // A fresh transaction per lookup: awaiting inside one lets it auto-commit
  // between requests. Two reads per map, on a library of a handful.
  const summaries = await Promise.all(
    rows.map(async ({ id, name, updatedAt, createdAt, starred }) => ({
      id,
      name,
      updatedAt,
      createdAt,
      starred,
      versionCount: await countVersions(db, id),
      thumb: await latestThumb(db, id),
    })),
  );
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Order maps for the library list: the chosen sort, with name ties (two
 * "Untitled map"s) and same-millisecond timestamps falling back to
 * newest-edited first.
 *
 * A star is not a position. It is a tag the dialog's star filter reads, so a
 * starred map sorts exactly where the chosen mode puts it — the same rule
 * `listVersions` follows.
 */
export function sortMaps(rows: MapSummary[], sort: MapSort): MapSummary[] {
  const byMode = (a: MapSummary, b: MapSummary): number =>
    sort === 'name'
      ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      : sort === 'created'
        ? b.createdAt - a.createdAt
        : 0;
  return [...rows].sort((a, b) => byMode(a, b) || b.updatedAt - a.updatedAt);
}

function countVersions(db: IDBDatabase, mapId: string): Promise<number> {
  const index = db.transaction('versions', 'readonly').objectStore('versions').index('mapId');
  return reqDone(index.count(IDBKeyRange.only(mapId)));
}

function latestThumb(db: IDBDatabase, mapId: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve, reject) => {
    const index = db.transaction('versions', 'readonly').objectStore('versions').index('mapId');
    const req = index.openCursor(IDBKeyRange.only(mapId), 'prev');
    let seen = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(undefined);
      const thumb = (cursor.value as VersionMeta).thumb;
      if (thumb) return resolve(thumb);
      if (++seen >= THUMB_WALK_BACK) return resolve(undefined);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * One map's versions, newest-first. A star does not move a row here either —
 * it shields the version from the prune policy, and answers the dialog's star
 * filter.
 */
export async function listVersions(mapId: string): Promise<VersionMeta[]> {
  const db = await openDb();
  const index = db.transaction('versions', 'readonly').objectStore('versions').index('mapId');
  const rows = await reqDone<VersionMeta[]>(index.getAll(IDBKeyRange.only(mapId)));
  // Two saves can land in the same millisecond; the id breaks the tie in the
  // same direction, so the order is total.
  return rows.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
}

export async function getPayload(versionId: number): Promise<string | undefined> {
  const db = await openDb();
  const row = await reqDone<PayloadRow | undefined>(
    db.transaction('payloads', 'readonly').objectStore('payloads').get(versionId),
  );
  return row?.json;
}

/**
 * Read-modify-write one version row. A row that is gone is not an error: the
 * dialog can be looking at a list the prune policy has already moved past.
 */
async function patchVersion(versionId: number, patch: (row: VersionMeta) => void): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('versions', 'readwrite');
  const store = tx.objectStore('versions');
  const getReq = store.get(versionId);
  getReq.onsuccess = () => {
    const row = getReq.result as VersionMeta | undefined;
    if (!row) return;
    patch(row);
    store.put(row);
  };
  return txDone(tx, () => undefined);
}

/**
 * Label a version, or clear the label with a blank string. Absent-when-empty:
 * a blank name is deleted rather than stored, which keeps the row honest and is
 * also what `isPrunable` reads — whitespace is not an act of preservation.
 */
export function setVersionName(versionId: number, name: string): Promise<void> {
  return patchVersion(versionId, (row) => {
    const trimmed = name.trim();
    if (trimmed) row.name = trimmed;
    else delete row.name;
  });
}

/** Star a version, or un-star it — which hands it back to the prune policy. */
export function setVersionStarred(versionId: number, starred: boolean): Promise<void> {
  return patchVersion(versionId, (row) => {
    if (starred) row.starred = true;
    else delete row.starred;
  });
}

/** Read-modify-write one map row. A row that is gone is not an error, same
 *  as `patchVersion`: the dialog can be looking at a list a delete has
 *  already moved past. */
async function patchMap(mapId: string, patch: (row: MapRow) => void): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('maps', 'readwrite');
  const store = tx.objectStore('maps');
  const getReq = store.get(mapId);
  getReq.onsuccess = () => {
    const row = getReq.result as MapRow | undefined;
    if (!row) return;
    patch(row);
    store.put(row);
  };
  return txDone(tx, () => undefined);
}

/** Rename the library row only — a saved version's own JSON is never rewritten. */
export function renameMap(mapId: string, name: string): Promise<void> {
  return patchMap(mapId, (row) => {
    row.name = name;
  });
}

/** Star a map — a tag its list can be filtered down to — or un-star it. */
export function setMapStarred(mapId: string, starred: boolean): Promise<void> {
  return patchMap(mapId, (row) => {
    if (starred) row.starred = true;
    else delete row.starred;
  });
}

/**
 * Delete a map outright: its row, its versions, its payloads — and with them
 * its counter, so a later map that happened to reuse the id starts at v1. That
 * is not a reused number: the map it belonged to no longer exists.
 */
export async function deleteMap(mapId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  tx.objectStore('maps').delete(mapId);
  const payloads = tx.objectStore('payloads');
  const cursorReq = tx.objectStore('versions').index('mapId').openCursor(IDBKeyRange.only(mapId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    payloads.delete(cursor.value.id);
    cursor.delete();
    cursor.continue();
  };
  return txDone(tx, () => undefined);
}

/** Delete one version. The map's counter is untouched: v3 is spent forever. */
export async function deleteVersion(versionId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['versions', 'payloads'], 'readwrite');
  tx.objectStore('versions').delete(versionId);
  tx.objectStore('payloads').delete(versionId);
  return txDone(tx, () => undefined);
}

export function newMapId(): string {
  return globalThis.crypto.randomUUID();
}
