/**
 * The map library: revisions of saved maps, in IndexedDB.
 *
 * This module knows NOTHING about `MapDoc`. It stores opaque strings — a row
 * IS a file, byte-for-byte what `serialize()` produced — so `parse()` remains
 * the single ingestion path that owns migration. Storing the structured object
 * instead would be one keystroke away (IndexedDB structured-clones happily) and
 * would bypass the version envelope; don't.
 *
 * Keyed by a minted library id, never by name: two maps may share a name, and
 * a rename must not orphan history.
 */

const DB_NAME = 'massimo-library';
const DB_VERSION = 1;
const CURRENT_KEY = 'massimo-library-current';

/** Revisions kept per map; the oldest are pruned past this. */
export const REVISION_LIMIT = 100;

/**
 * How far back a map row looks for a thumbnail. A save can legitimately have
 * none (empty canvas, or a rasterization failure), and a blank row would
 * throw away one of the only two things telling same-named maps apart.
 */
const THUMB_WALK_BACK = 5;

export type RevisionSource = 'user' | 'auto';

export interface MapSummary {
  id: string;
  name: string;
  updatedAt: number;
  revisionCount: number;
  thumb?: string;
}

export interface RevisionMeta {
  id: number;
  mapId: string;
  savedAt: number;
  source: RevisionSource;
  thumb?: string;
}

interface MapRow {
  id: string;
  name: string;
  updatedAt: number;
}

interface PayloadRow {
  id: number;
  json: string;
}

// Payloads live in their own store so listing never drags 256 KB of JSON per
// map through a structured clone.
const STORES = ['maps', 'revisions', 'payloads'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('maps', { keyPath: 'id' });
      const revisions = db.createObjectStore('revisions', { keyPath: 'id', autoIncrement: true });
      revisions.createIndex('mapId', 'mapId', { unique: false });
      db.createObjectStore('payloads', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
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
 * wipes the document on a successful save would wipe it against a revision
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
 * Drop the oldest revisions (and their payloads) past the cap. Issued inside
 * the caller's transaction — the index cursor runs oldest-first because, for a
 * single mapId, index order is primary-key order and the key autoIncrements.
 */
function pruneWithin(tx: IDBTransaction, mapId: string): void {
  const revisions = tx.objectStore('revisions');
  const payloads = tx.objectStore('payloads');
  const index = revisions.index('mapId');
  const countReq = index.count(IDBKeyRange.only(mapId));
  countReq.onsuccess = () => {
    let excess = countReq.result - REVISION_LIMIT;
    if (excess <= 0) return;
    const cursorReq = index.openCursor(IDBKeyRange.only(mapId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      payloads.delete(cursor.value.id);
      cursor.delete();
      if (--excess > 0) cursor.continue();
    };
  };
}

/**
 * Write a revision of `json` under `mapId`, upserting the map row's name and
 * timestamp. Resolves with the new revision id once the transaction commits.
 * Rejects — and writes nothing — on any storage failure.
 */
export async function saveRevision(
  mapId: string,
  name: string,
  json: string,
  source: RevisionSource,
  thumb?: string,
): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  const now = Date.now();
  let newId = 0;

  // `put` is an upsert: first save creates the row, later ones refresh it.
  tx.objectStore('maps').put({ id: mapId, name, updatedAt: now } satisfies MapRow);
  const addReq = tx.objectStore('revisions').add({ mapId, savedAt: now, source, thumb });
  addReq.onsuccess = () => {
    newId = addReq.result as number;
    tx.objectStore('payloads').put({ id: newId, json } satisfies PayloadRow);
    pruneWithin(tx, mapId);
  };

  return txDone(tx, () => newId);
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
    rows.map(async (row) => ({
      ...row,
      revisionCount: await countRevisions(db, row.id),
      thumb: await latestThumb(db, row.id),
    })),
  );
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function countRevisions(db: IDBDatabase, mapId: string): Promise<number> {
  const index = db.transaction('revisions', 'readonly').objectStore('revisions').index('mapId');
  return reqDone(index.count(IDBKeyRange.only(mapId)));
}

function latestThumb(db: IDBDatabase, mapId: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve, reject) => {
    const index = db.transaction('revisions', 'readonly').objectStore('revisions').index('mapId');
    const req = index.openCursor(IDBKeyRange.only(mapId), 'prev');
    let seen = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(undefined);
      const thumb = (cursor.value as RevisionMeta).thumb;
      if (thumb) return resolve(thumb);
      if (++seen >= THUMB_WALK_BACK) return resolve(undefined);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** One map's revisions, newest first. */
export async function listRevisions(mapId: string): Promise<RevisionMeta[]> {
  const db = await openDb();
  const index = db.transaction('revisions', 'readonly').objectStore('revisions').index('mapId');
  const rows = await reqDone<RevisionMeta[]>(index.getAll(IDBKeyRange.only(mapId)));
  // Two saves can land in the same millisecond; the id breaks the tie in the
  // same direction, so the order is total.
  return rows.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
}

export async function getPayload(revisionId: number): Promise<string | undefined> {
  const db = await openDb();
  const row = await reqDone<PayloadRow | undefined>(
    db.transaction('payloads', 'readonly').objectStore('payloads').get(revisionId),
  );
  return row?.json;
}

/** Rename the library row only — a saved revision's own JSON is never rewritten. */
export async function renameMap(mapId: string, name: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('maps', 'readwrite');
  const store = tx.objectStore('maps');
  const getReq = store.get(mapId);
  getReq.onsuccess = () => {
    const row = getReq.result as MapRow | undefined;
    if (row) store.put({ ...row, name });
  };
  return txDone(tx, () => undefined);
}

export async function deleteMap(mapId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  tx.objectStore('maps').delete(mapId);
  const payloads = tx.objectStore('payloads');
  const cursorReq = tx.objectStore('revisions').index('mapId').openCursor(IDBKeyRange.only(mapId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    payloads.delete(cursor.value.id);
    cursor.delete();
    cursor.continue();
  };
  return txDone(tx, () => undefined);
}

export async function deleteRevision(revisionId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['revisions', 'payloads'], 'readwrite');
  tx.objectStore('revisions').delete(revisionId);
  tx.objectStore('payloads').delete(revisionId);
  return txDone(tx, () => undefined);
}

export function newMapId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Which library map the live document belongs to. Deliberately outside the
 * doc: a downloaded file carries no id, so loading one and saving it creates a
 * new map rather than two files fighting over one history.
 */
export function getCurrentMapId(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentMapId(id: string | null): void {
  // NOT setItem(key, null) — that stores the string "null", which is truthy and
  // survives `??`, so `getCurrentMapId() ?? newMapId()` would hand back "null"
  // and every file loaded thereafter would write into one shared bogus map.
  if (id === null) localStorage.removeItem(CURRENT_KEY);
  else localStorage.setItem(CURRENT_KEY, id);
}
