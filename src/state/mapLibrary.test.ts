import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * fake-indexeddb is imported HERE ONLY — never in the global test setup. Each
 * test gets a brand-new `IDBFactory` (a fresh, empty universe of databases)
 * plus a re-imported module, so no state and no cached connection survives.
 *
 * Deliberately NOT `deleteDatabase`: that fires `versionchange`, and a cached
 * connection with no handler sends the request to `blocked`, where it never
 * settles and times the whole file out.
 */
type Lib = typeof import('./mapLibrary');
let lib: Lib;

beforeEach(async () => {
  const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();
  // jsdom ships neither of these; the module calls IDBKeyRange.only().
  globalThis.IDBKeyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  vi.resetModules();
  lib = await import('./mapLibrary');
  localStorage.clear();
});

const json = (s: string) => `{"format":"massimo-map","version":2,"doc":{"name":"${s}"}}`;

describe('mapLibrary', () => {
  it('round-trips the exact payload string', async () => {
    const payload = json('A');
    const revId = await lib.saveRevision('m1', 'A', payload, 'user');
    expect(await lib.getPayload(revId)).toBe(payload);
  });

  it('groups revisions of one map under a single library row', async () => {
    await lib.saveRevision('m1', 'A', json('A'), 'user');
    await lib.saveRevision('m1', 'A2', json('A2'), 'user');
    const maps = await lib.listMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].revisionCount).toBe(2);
  });

  // D2: ids key the library, so a shared name is not a collision.
  it('keeps two same-named maps apart when their ids differ', async () => {
    await lib.saveRevision('m1', 'Same', json('1'), 'user');
    await lib.saveRevision('m2', 'Same', json('2'), 'user');
    const maps = await lib.listMaps();
    expect(maps).toHaveLength(2);
    expect(maps.map((m) => m.name)).toEqual(['Same', 'Same']);
  });

  it('tracks the name as of the latest save', async () => {
    await lib.saveRevision('m1', 'Old', json('1'), 'user');
    await lib.saveRevision('m1', 'New', json('2'), 'user');
    expect((await lib.listMaps())[0].name).toBe('New');
  });

  it('round-trips each revision source tag', async () => {
    await lib.saveRevision('m1', 'A', json('1'), 'user');
    await lib.saveRevision('m1', 'A', json('2'), 'auto');
    const sources = (await lib.listRevisions('m1')).map((r) => r.source);
    expect(sources.sort()).toEqual(['auto', 'user']);
  });

  it('prunes to the revision limit, dropping the oldest', async () => {
    for (let i = 0; i <= lib.REVISION_LIMIT; i++) {
      await lib.saveRevision('m1', 'A', json(`r${i}`), 'user');
    }
    const revs = await lib.listRevisions('m1');
    expect(revs).toHaveLength(lib.REVISION_LIMIT);
    // r0 was the first written and is the one that must be gone.
    const payloads = await Promise.all(revs.map((r) => lib.getPayload(r.id)));
    expect(payloads).not.toContain(json('r0'));
    expect(payloads).toContain(json(`r${lib.REVISION_LIMIT}`));
  });

  // A pruned revision row whose payload survives is a 256 KB leak per prune.
  it('prunes the payload alongside the revision row', async () => {
    const first = await lib.saveRevision('m1', 'A', json('r0'), 'user');
    for (let i = 1; i <= lib.REVISION_LIMIT; i++) {
      await lib.saveRevision('m1', 'A', json(`r${i}`), 'user');
    }
    expect(await lib.getPayload(first)).toBeUndefined();
  });

  it('renames a map without touching its revisions', async () => {
    await lib.saveRevision('m1', 'Old', json('1'), 'user');
    const before = await lib.listRevisions('m1');
    await lib.renameMap('m1', 'Renamed');
    expect((await lib.listMaps())[0].name).toBe('Renamed');
    expect(await lib.listRevisions('m1')).toEqual(before);
  });

  it('deletes a map with its revisions and payloads, leaving others intact', async () => {
    const doomed = await lib.saveRevision('m1', 'A', json('1'), 'user');
    const keep = await lib.saveRevision('m2', 'B', json('2'), 'user');
    await lib.deleteMap('m1');
    expect(await lib.listMaps()).toHaveLength(1);
    expect(await lib.listRevisions('m1')).toEqual([]);
    expect(await lib.getPayload(doomed)).toBeUndefined();
    expect(await lib.getPayload(keep)).toBe(json('2'));
  });

  it('deletes exactly one revision and its payload', async () => {
    const a = await lib.saveRevision('m1', 'A', json('1'), 'user');
    const b = await lib.saveRevision('m1', 'A', json('2'), 'user');
    await lib.deleteRevision(a);
    expect((await lib.listRevisions('m1')).map((r) => r.id)).toEqual([b]);
    expect(await lib.getPayload(a)).toBeUndefined();
    expect(await lib.getPayload(b)).toBe(json('2'));
  });

  it('orders maps and revisions newest-first', async () => {
    // Only Date is faked: vi.useFakeTimers() would also stub the task queue
    // fake-indexeddb schedules its request callbacks on, and every await hangs.
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(Date.parse('2026-07-15T10:00:00Z'));
    await lib.saveRevision('m1', 'Older', json('1'), 'user');
    clock.mockReturnValue(Date.parse('2026-07-15T11:00:00Z'));
    await lib.saveRevision('m2', 'Newer', json('2'), 'user');
    clock.mockReturnValue(Date.parse('2026-07-15T12:00:00Z'));
    await lib.saveRevision('m1', 'Older-but-touched', json('3'), 'user');
    clock.mockRestore();

    expect((await lib.listMaps()).map((m) => m.id)).toEqual(['m1', 'm2']);
    const revs = await lib.listRevisions('m1');
    expect(revs.map((r) => r.savedAt)).toEqual([
      Date.parse('2026-07-15T12:00:00Z'),
      Date.parse('2026-07-15T10:00:00Z'),
    ]);
  });

  // A thumb-less save (empty canvas / rasterization failure) must not blank the
  // library row while good thumbs sit on earlier revisions.
  it('falls back to the latest AVAILABLE thumb for the map row', async () => {
    await lib.saveRevision('m1', 'A', json('1'), 'user', 'data:image/png;base64,GOOD');
    await lib.saveRevision('m1', 'A', json('2'), 'user', undefined);
    expect((await lib.listMaps())[0].thumb).toBe('data:image/png;base64,GOOD');
  });

  /**
   * B2. The revision id exists at the add request's `onsuccess`, which is
   * exactly where an implementer reaches for `resolve(id)` — and the
   * transaction has NOT committed there. Settling early reports success for a
   * write that never landed, and New then wipes a document whose revision does
   * not exist.
   */
  it('rejects when the transaction aborts after the add succeeded', async () => {
    const { IDBObjectStore } = await import('fake-indexeddb');
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const req = realPut.call(this, value, key);
      // Abort once the payload write lands — the revision `add` has already
      // succeeded and handed over an id by then, which is exactly where a
      // quota failure would strike and exactly where resolving is a lie.
      if (this.name === 'payloads') {
        req.addEventListener('success', () => req.transaction?.abort());
      }
      return req;
    });

    await expect(lib.saveRevision('m1', 'A', json('1'), 'user')).rejects.toThrow();
    spy.mockRestore();
    expect(await lib.listMaps()).toEqual([]);
    expect(await lib.listRevisions('m1')).toEqual([]);
  });

  describe('current map pointer', () => {
    it('round-trips an id', () => {
      lib.setCurrentMapId('m1');
      expect(lib.getCurrentMapId()).toBe('m1');
    });

    /**
     * A naive setItem(KEY, null) stores the STRING "null", which is truthy and
     * survives `??`. `getCurrentMapId() ?? newMapId()` would then return "null"
     * and every loaded file would write into one shared bogus map, forever.
     */
    it('clears to a real null, never the string "null"', () => {
      lib.setCurrentMapId('m1');
      lib.setCurrentMapId(null);
      expect(lib.getCurrentMapId()).toBeNull();
      expect(localStorage.getItem('massimo-library-current')).toBeNull();
      expect(lib.getCurrentMapId() ?? lib.newMapId()).not.toBe('null');
    });

    it('mints a fresh unique id', () => {
      expect(lib.newMapId()).not.toBe(lib.newMapId());
    });
  });
});
