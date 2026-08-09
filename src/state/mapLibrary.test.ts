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

/** Save `n` auto versions of m1, so a prune test can reach past the limit. */
const autoSaves = async (n: number, mapId = 'm1') => {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await lib.saveVersion(mapId, 'A', json(`a${i}`), 'auto')).id);
  }
  return ids;
};

describe('mapLibrary', () => {
  it('round-trips the exact payload string', async () => {
    const payload = json('A');
    const { id } = await lib.saveVersion('m1', 'A', payload, 'user');
    expect(await lib.getPayload(id)).toBe(payload);
  });

  it('groups versions of one map under a single library row', async () => {
    await lib.saveVersion('m1', 'A', json('A'), 'user');
    await lib.saveVersion('m1', 'A2', json('A2'), 'user');
    const maps = await lib.listMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].versionCount).toBe(2);
  });

  // D2: ids key the library, so a shared name is not a collision.
  it('keeps two same-named maps apart when their ids differ', async () => {
    await lib.saveVersion('m1', 'Same', json('1'), 'user');
    await lib.saveVersion('m2', 'Same', json('2'), 'user');
    const maps = await lib.listMaps();
    expect(maps).toHaveLength(2);
    expect(maps.map((m) => m.name)).toEqual(['Same', 'Same']);
  });

  it('tracks the name as of the latest save', async () => {
    await lib.saveVersion('m1', 'Old', json('1'), 'user');
    await lib.saveVersion('m1', 'New', json('2'), 'user');
    expect((await lib.listMaps())[0].name).toBe('New');
  });

  it('round-trips each version source tag', async () => {
    await lib.saveVersion('m1', 'A', json('1'), 'user');
    await lib.saveVersion('m1', 'A', json('2'), 'auto');
    const sources = (await lib.listVersions('m1')).map((r) => r.source);
    expect(sources.sort()).toEqual(['auto', 'user']);
  });

  it('renames a map without touching its versions', async () => {
    await lib.saveVersion('m1', 'Old', json('1'), 'user');
    const before = await lib.listVersions('m1');
    await lib.renameMap('m1', 'Renamed');
    expect((await lib.listMaps())[0].name).toBe('Renamed');
    expect(await lib.listVersions('m1')).toEqual(before);
  });

  it('deletes a map with its versions and payloads, leaving others intact', async () => {
    const doomed = await lib.saveVersion('m1', 'A', json('1'), 'user');
    const keep = await lib.saveVersion('m2', 'B', json('2'), 'user');
    await lib.deleteMap('m1');
    expect(await lib.listMaps()).toHaveLength(1);
    expect(await lib.listVersions('m1')).toEqual([]);
    expect(await lib.getPayload(doomed.id)).toBeUndefined();
    expect(await lib.getPayload(keep.id)).toBe(json('2'));
  });

  it('deletes exactly one version and its payload', async () => {
    const a = await lib.saveVersion('m1', 'A', json('1'), 'user');
    const b = await lib.saveVersion('m1', 'A', json('2'), 'user');
    await lib.deleteVersion(a.id);
    expect((await lib.listVersions('m1')).map((r) => r.id)).toEqual([b.id]);
    expect(await lib.getPayload(a.id)).toBeUndefined();
    expect(await lib.getPayload(b.id)).toBe(json('2'));
  });

  /**
   * m1 is created first and m2 last, so getAll()'s primary-key order is
   * ['m1','m2'] and the newest-touched-first answer is the OPPOSITE. Ordering
   * the fixture the other way round makes the expectation coincide with the
   * unsorted result, and `listMaps`'s sort can then be deleted outright with
   * this test still green.
   */
  it('orders maps newest-first, and versions newest-first within a map', async () => {
    // Only Date is faked: vi.useFakeTimers() would also stub the task queue
    // fake-indexeddb schedules its request callbacks on, and every await hangs.
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(Date.parse('2026-07-15T10:00:00Z'));
    await lib.saveVersion('m1', 'A', json('1'), 'user');
    clock.mockReturnValue(Date.parse('2026-07-15T11:00:00Z'));
    await lib.saveVersion('m1', 'A', json('2'), 'user');
    clock.mockReturnValue(Date.parse('2026-07-15T12:00:00Z'));
    await lib.saveVersion('m2', 'B', json('3'), 'user');
    clock.mockRestore();

    expect((await lib.listMaps()).map((m) => m.id)).toEqual(['m2', 'm1']);
    const versions = await lib.listVersions('m1');
    expect(versions.map((r) => r.savedAt)).toEqual([
      Date.parse('2026-07-15T11:00:00Z'),
      Date.parse('2026-07-15T10:00:00Z'),
    ]);
  });

  describe('map creation dates', () => {
    it('stamps createdAt at the first save and keeps it across later saves', async () => {
      const clock = vi.spyOn(Date, 'now');
      clock.mockReturnValue(Date.parse('2026-07-15T10:00:00Z'));
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      clock.mockReturnValue(Date.parse('2026-07-15T11:00:00Z'));
      await lib.saveVersion('m1', 'A', json('2'), 'user');
      clock.mockRestore();
      const [m] = await lib.listMaps();
      expect(m.createdAt).toBe(Date.parse('2026-07-15T10:00:00Z'));
      expect(m.updatedAt).toBe(Date.parse('2026-07-15T11:00:00Z'));
    });
  });

  describe('map stars', () => {
    it('round-trips a star, and drops the flag when un-starred', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setMapStarred('m1', true);
      expect((await lib.listMaps())[0].starred).toBe(true);
      await lib.setMapStarred('m1', false);
      expect((await lib.listMaps())[0].starred).toBeUndefined();
    });

    // saveVersion's write to the maps store is an upsert; a fresh row built
    // from scratch would silently shed the star on the very next auto-save.
    it('keeps the star across later saves of the map', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setMapStarred('m1', true);
      await lib.saveVersion('m1', 'A', json('2'), 'auto');
      expect((await lib.listMaps())[0].starred).toBe(true);
    });

    it('leaves the star alone through a rename', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setMapStarred('m1', true);
      await lib.renameMap('m1', 'Renamed');
      expect((await lib.listMaps())[0].starred).toBe(true);
    });

    it('ignores a star aimed at a map that is gone', async () => {
      await expect(lib.setMapStarred('nope', true)).resolves.toBeUndefined();
    });
  });

  // MAP_SORTS is the ladder the picker takes its order from and the guard
  // judges by, so the two halves cannot disagree: a rung the guard rejected
  // would leave a persisted pref unusable on the next boot, and one the picker
  // skipped would leave it unreachable in the UI.
  describe('MAP_SORTS', () => {
    it('is exactly what isMapSort accepts', () => {
      for (const s of lib.MAP_SORTS) expect(lib.isMapSort(s)).toBe(true);
      expect(lib.isMapSort('starred')).toBe(false);
      expect(lib.isMapSort('')).toBe(false);
    });
  });

  describe('sortMaps', () => {
    type Summary = import('./mapLibrary').MapSummary;
    const summary = (over: Partial<Summary> & { id: string }): Summary => ({
      name: over.id,
      updatedAt: 0,
      createdAt: 0,
      versionCount: 1,
      ...over,
    });

    // A star is a tag the dialog's star filter reads, not a position: the
    // row it marks sorts exactly where the chosen mode puts it. The fixture is
    // rigged so a surviving pin would be visible in every mode — 'z' is last by
    // name, oldest by both timestamps.
    it('does not move a starred map, in any mode', () => {
      const rows = [
        summary({ id: 'a', updatedAt: 3, createdAt: 3 }),
        summary({ id: 'z', updatedAt: 1, createdAt: 1, starred: true }),
      ];
      for (const mode of lib.MAP_SORTS) {
        expect(lib.sortMaps(rows, mode).map((m) => m.id)).toEqual(['a', 'z']);
      }
    });

    it("'updated' orders newest-edited first", () => {
      const rows = [
        summary({ id: 'a', updatedAt: 1 }),
        summary({ id: 'b', updatedAt: 3 }),
        summary({ id: 'c', updatedAt: 2 }),
      ];
      expect(lib.sortMaps(rows, 'updated').map((m) => m.id)).toEqual(['b', 'c', 'a']);
    });

    // updatedAt deliberately disagrees with createdAt, so a mode that quietly
    // reads the wrong field cannot pass.
    it("'created' orders newest-created first", () => {
      const rows = [
        summary({ id: 'a', createdAt: 2, updatedAt: 1 }),
        summary({ id: 'b', createdAt: 1, updatedAt: 3 }),
        summary({ id: 'c', createdAt: 3, updatedAt: 2 }),
      ];
      expect(lib.sortMaps(rows, 'created').map((m) => m.id)).toEqual(['c', 'a', 'b']);
    });

    it("'name' orders alphabetically, case-insensitively, ties broken by last edit", () => {
      const rows = [
        summary({ id: 'x', name: 'delta', updatedAt: 1 }),
        summary({ id: 'y', name: 'Alpha', updatedAt: 1 }),
        summary({ id: 'twin-old', name: 'Canal', updatedAt: 1 }),
        summary({ id: 'twin-new', name: 'Canal', updatedAt: 2 }),
      ];
      expect(lib.sortMaps(rows, 'name').map((m) => m.id)).toEqual([
        'y',
        'twin-new',
        'twin-old',
        'x',
      ]);
    });

    it('returns a new array rather than mutating its input', () => {
      const rows = [summary({ id: 'a', updatedAt: 1 }), summary({ id: 'b', updatedAt: 2 })];
      const out = lib.sortMaps(rows, 'updated');
      expect(out).not.toBe(rows);
      expect(rows.map((m) => m.id)).toEqual(['a', 'b']);
    });
  });

  // A thumb-less save (empty canvas / rasterization failure) must not blank the
  // library row while good thumbs sit on earlier versions.
  it('falls back to the latest AVAILABLE thumb for the map row', async () => {
    await lib.saveVersion('m1', 'A', json('1'), 'user', 'data:image/png;base64,GOOD');
    await lib.saveVersion('m1', 'A', json('2'), 'user', undefined);
    expect((await lib.listMaps())[0].thumb).toBe('data:image/png;base64,GOOD');
  });

  /**
   * B2. The version id exists at the add request's `onsuccess`, which is
   * exactly where an implementer reaches for `resolve(id)` — and the
   * transaction has NOT committed there. Settling early reports success for a
   * write that never landed, and New then wipes a document whose version does
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
      // Abort once the payload write lands — the version `add` has already
      // succeeded and handed over an id by then, which is exactly where a
      // quota failure would strike and exactly where resolving is a lie.
      if (this.name === 'payloads') {
        req.addEventListener('success', () => req.transaction?.abort());
      }
      return req;
    });

    await expect(lib.saveVersion('m1', 'A', json('1'), 'user')).rejects.toThrow();
    spy.mockRestore();
    expect(await lib.listMaps()).toEqual([]);
    expect(await lib.listVersions('m1')).toEqual([]);
  });

  /**
   * The version number is the map's public handle ("open v32"), so it must be
   * stable for the life of the map. Every case below is one way a naive
   * `max(version) + 1` or `count() + 1` silently hands the same number to two
   * different maps-in-time.
   */
  describe('version numbering', () => {
    it('stamps versions from 1, monotonically', async () => {
      const a = await lib.saveVersion('m1', 'A', json('1'), 'user');
      const b = await lib.saveVersion('m1', 'A', json('2'), 'user');
      expect([a.version, b.version]).toEqual([1, 2]);
      expect((await lib.listVersions('m1')).map((r) => r.version)).toEqual([2, 1]);
    });

    it('numbers each map on its own counter', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.saveVersion('m1', 'A', json('2'), 'user');
      const first = await lib.saveVersion('m2', 'B', json('3'), 'user');
      expect(first.version).toBe(1);
    });

    // The headline case: make v3, delete it, save again -> v4, never v3 again.
    it('does not reuse the number of a deleted newest version', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.saveVersion('m1', 'A', json('2'), 'user');
      const third = await lib.saveVersion('m1', 'A', json('3'), 'user');
      expect(third.version).toBe(3);
      await lib.deleteVersion(third.id);
      const next = await lib.saveVersion('m1', 'A', json('4'), 'user');
      expect(next.version).toBe(4);
    });

    it('does not reuse numbers after every version is deleted', async () => {
      const a = await lib.saveVersion('m1', 'A', json('1'), 'user');
      const b = await lib.saveVersion('m1', 'A', json('2'), 'user');
      await lib.deleteVersion(a.id);
      await lib.deleteVersion(b.id);
      expect((await lib.saveVersion('m1', 'A', json('3'), 'user')).version).toBe(3);
    });

    // Routine policy pruning must not move the numbers either.
    it('does not reuse numbers after pruning', async () => {
      await autoSaves(lib.AUTO_VERSION_LIMIT + 2);
      const survivors = (await lib.listVersions('m1')).map((r) => r.version);
      expect(survivors).toHaveLength(lib.AUTO_VERSION_LIMIT);
      // The oldest two were pruned, so the survivors start at 3 and the next
      // save continues past the highest — no number is ever handed out twice.
      expect(Math.min(...survivors)).toBe(3);
      const next = await lib.saveVersion('m1', 'A', json('x'), 'user');
      expect(next.version).toBe(lib.AUTO_VERSION_LIMIT + 3);
    });

    // Deleting a map is not "policy" — the map, its counter and its history are
    // gone together, and a re-used id is a genuinely new map starting at v1.
    it('restarts numbering when the whole map is deleted', async () => {
      await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.deleteMap('m1');
      expect((await lib.saveVersion('m1', 'A', json('2'), 'user')).version).toBe(1);
    });
  });

  describe('pruning policy', () => {
    it('keeps every user version, however far past the auto limit', async () => {
      for (let i = 0; i <= lib.AUTO_VERSION_LIMIT; i++) {
        await lib.saveVersion('m1', 'A', json(`u${i}`), 'user');
      }
      expect(await lib.listVersions('m1')).toHaveLength(lib.AUTO_VERSION_LIMIT + 1);
    });

    it('prunes auto versions past the limit, oldest first', async () => {
      await autoSaves(lib.AUTO_VERSION_LIMIT + 1);
      const versions = await lib.listVersions('m1');
      expect(versions).toHaveLength(lib.AUTO_VERSION_LIMIT);
      const payloads = await Promise.all(versions.map((r) => lib.getPayload(r.id)));
      expect(payloads).not.toContain(json('a0'));
      expect(payloads).toContain(json(`a${lib.AUTO_VERSION_LIMIT}`));
    });

    // A pruned version row whose payload survives is a 256 KB leak per prune.
    it('prunes the payload alongside the version row', async () => {
      const [first] = await autoSaves(1);
      await autoSaves(lib.AUTO_VERSION_LIMIT);
      expect(await lib.getPayload(first)).toBeUndefined();
    });

    // Autos are disposable only until you say otherwise. A star is that act,
    // and pruning one is silent data loss of the exact thing you marked.
    it('never prunes a starred auto version', async () => {
      const [first] = await autoSaves(1);
      await lib.setVersionStarred(first, true);
      await autoSaves(lib.AUTO_VERSION_LIMIT + 2);
      expect(await lib.getPayload(first)).toBe(json('a0'));
      expect((await lib.listVersions('m1')).some((r) => r.id === first)).toBe(true);
    });

    // Same reasoning: naming one is the same act of "I care about this".
    it('never prunes a named auto version', async () => {
      const [first] = await autoSaves(1);
      await lib.setVersionName(first, 'beta 1 — needs work');
      await autoSaves(lib.AUTO_VERSION_LIMIT + 2);
      expect(await lib.getPayload(first)).toBe(json('a0'));
    });

    // Protected rows must not eat the budget: the limit counts only the autos
    // that pruning is actually allowed to take.
    it('keeps a full limit of prunable autos alongside protected ones', async () => {
      const [pinned] = await autoSaves(1);
      await lib.setVersionStarred(pinned, true);
      await autoSaves(lib.AUTO_VERSION_LIMIT + 2);
      const versions = await lib.listVersions('m1');
      expect(versions.filter((r) => !r.starred)).toHaveLength(lib.AUTO_VERSION_LIMIT);
      expect(versions).toHaveLength(lib.AUTO_VERSION_LIMIT + 1);
    });

    // Un-starring hands the row back to the policy — it must not stay immortal.
    it('prunes a version that was starred and then un-starred', async () => {
      const [first] = await autoSaves(1);
      await lib.setVersionStarred(first, true);
      await autoSaves(lib.AUTO_VERSION_LIMIT + 2);
      await lib.setVersionStarred(first, false);
      await autoSaves(1);
      expect(await lib.getPayload(first)).toBeUndefined();
    });
  });

  describe('version names and stars', () => {
    it('round-trips a name', async () => {
      const { id } = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setVersionName(id, 'beta 1');
      expect((await lib.listVersions('m1'))[0].name).toBe('beta 1');
    });

    // Absent-when-empty keeps the row shape honest, and is what the prune
    // predicate reads: a whitespace-only name is not an act of preservation.
    it('drops an emptied or whitespace-only name rather than storing it', async () => {
      const { id } = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setVersionName(id, 'beta 1');
      await lib.setVersionName(id, '   ');
      expect((await lib.listVersions('m1'))[0].name).toBeUndefined();
    });

    it('trims a name', async () => {
      const { id } = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setVersionName(id, '  beta 1  ');
      expect((await lib.listVersions('m1'))[0].name).toBe('beta 1');
    });

    it('round-trips a star, and drops the flag when un-starred', async () => {
      const { id } = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setVersionStarred(id, true);
      expect((await lib.listVersions('m1'))[0].starred).toBe(true);
      await lib.setVersionStarred(id, false);
      expect((await lib.listVersions('m1'))[0].starred).toBeUndefined();
    });

    // The star shields a version from the prune policy and answers the dialog's
    // star filter. It does not reorder the list: the oldest version stays
    // at the bottom however loudly it is marked.
    it('leaves the order newest-first however the stars fall', async () => {
      const a = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.saveVersion('m1', 'A', json('2'), 'user');
      const c = await lib.saveVersion('m1', 'A', json('3'), 'user');
      await lib.setVersionStarred(a.id, true);
      await lib.setVersionStarred(c.id, true);
      expect((await lib.listVersions('m1')).map((r) => r.version)).toEqual([3, 2, 1]);
    });

    it('leaves a name and star on a version the map rename does not touch', async () => {
      const { id } = await lib.saveVersion('m1', 'A', json('1'), 'user');
      await lib.setVersionName(id, 'beta 1');
      await lib.setVersionStarred(id, true);
      await lib.renameMap('m1', 'Renamed');
      const [row] = await lib.listVersions('m1');
      expect([row.name, row.starred]).toEqual(['beta 1', true]);
    });

    it('ignores a name or star aimed at a version that is gone', async () => {
      await expect(lib.setVersionName(999, 'x')).resolves.toBeUndefined();
      await expect(lib.setVersionStarred(999, true)).resolves.toBeUndefined();
    });
  });

  /**
   * The v1 schema shipped in #265 and has real maps in it. The upgrade renames
   * the `revisions` store and backfills the numbering that store never had —
   * and every test above runs on a virgin database, so NOTHING else in this
   * file would notice the upgrade path being broken.
   *
   * The payload linkage is the sharp edge: payload rows are keyed by the
   * version's autoIncrement id, so a copy that lets the new store mint fresh
   * ids orphans every payload in the library — each map silently loses its
   * entire history while still listing every row.
   */
  describe('schema migration (v1 → v2)', () => {
    /**
     * Build a v1 database by hand — the shape #265 actually shipped — and then
     * delete `dropIds` from it. Resolves with the SURVIVING revision ids.
     *
     * The deletion step is the point. v1 shipped both `deleteRevision` and
     * pruning, so every real v1 library has GAPS in its autoIncrement ids. Seed
     * a gapless 1,2,3,4 instead and a migration that re-mints ids hands back
     * 1,2,3,4 — the same numbers by coincidence — and the payload assertions
     * below pass while every payload in a real library orphans.
     */
    const seedV1 = (
      maps: { id: string; name: string; updatedAt: number }[],
      revisions: { mapId: string; savedAt: number; source: string; thumb?: string }[],
      dropIds: number[] = [],
    ) =>
      new Promise<number[]>((resolve, reject) => {
        const req = indexedDB.open('massimo-library', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('maps', { keyPath: 'id' });
          const revs = db.createObjectStore('revisions', { keyPath: 'id', autoIncrement: true });
          revs.createIndex('mapId', 'mapId', { unique: false });
          db.createObjectStore('payloads', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['maps', 'revisions', 'payloads'], 'readwrite');
          const ids: number[] = [];
          for (const m of maps) tx.objectStore('maps').put(m);
          for (const r of revisions) {
            const addReq = tx.objectStore('revisions').add(r);
            addReq.onsuccess = () => {
              const id = addReq.result as number;
              ids.push(id);
              tx.objectStore('payloads').put({ id, json: json(`payload-${id}`) });
            };
          }
          // A second transaction: the ids to drop only exist once the adds above
          // have run, and v1 deleted a revision with its payload.
          tx.oncomplete = () => {
            const dropTx = db.transaction(['revisions', 'payloads'], 'readwrite');
            for (const id of dropIds) {
              dropTx.objectStore('revisions').delete(id);
              dropTx.objectStore('payloads').delete(id);
            }
            dropTx.oncomplete = () => {
              // Close before the module opens at v2, or the upgrade parks on
              // `blocked` behind this handle and never settles.
              db.close();
              resolve(ids.filter((id) => !dropIds.includes(id)));
            };
            dropTx.onerror = () => reject(dropTx.error);
            dropTx.onabort = () => reject(dropTx.error);
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

    /** Ids 1..6 minted, 2 and 5 deleted: m1 keeps 1,3,6 and m2 keeps 4. */
    const seedTwoMaps = () =>
      seedV1(
        [
          { id: 'm1', name: 'Alpha', updatedAt: 10 },
          { id: 'm2', name: 'Beta', updatedAt: 20 },
        ],
        [
          { mapId: 'm1', savedAt: 1, source: 'user', thumb: 'data:image/png;base64,T1' },
          { mapId: 'm1', savedAt: 2, source: 'auto' },
          { mapId: 'm1', savedAt: 3, source: 'auto' },
          { mapId: 'm2', savedAt: 4, source: 'user' },
          { mapId: 'm1', savedAt: 5, source: 'user' },
          { mapId: 'm1', savedAt: 6, source: 'user' },
        ],
        [2, 5],
      );

    /**
     * The one that matters: every migrated version must still open the bytes it
     * was saved with.
     *
     * Deliberately NOT "is each payload still reachable by its old id" — the
     * upgrade never touches the payloads store, so that question is `true` even
     * when the linkage is completely severed. What breaks is the POINTER: a row
     * re-keyed from 6 to 4 now opens whatever was saved as 4, which may be
     * another map's document, or nothing at all.
     *
     * The seed gives each revision `savedAt === its original id` and writes that
     * id into its payload, so a row that drifted off its own bytes is visible.
     */
    it('keeps every version pointing at the payload it was saved with', async () => {
      await seedTwoMaps();
      for (const mapId of ['m1', 'm2']) {
        const rows = await lib.listVersions(mapId);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(await lib.getPayload(row.id)).toBe(json(`payload-${row.savedAt}`));
        }
      }
    });

    it('carries every row across, with its map, timestamp, source and thumb', async () => {
      await seedTwoMaps();
      const m1 = await lib.listVersions('m1');
      expect(m1).toHaveLength(3);
      expect(m1.map((r) => r.savedAt)).toEqual([6, 3, 1]);
      expect(m1.map((r) => r.source)).toEqual(['user', 'auto', 'user']);
      expect(m1.find((r) => r.savedAt === 1)?.thumb).toBe('data:image/png;base64,T1');
      expect(await lib.listVersions('m2')).toHaveLength(1);
      expect((await lib.listMaps()).map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    });

    // Chronological, per map, from 1 — a pre-existing map reads as if it had
    // been numbered all along. Note the gaps in the ids (1,3,6) do NOT become
    // gaps in the numbering: what v1 deleted was never numbered to begin with.
    it('backfills version numbers chronologically, per map, from 1', async () => {
      await seedTwoMaps();
      const m1 = await lib.listVersions('m1');
      expect(m1.map((r) => [r.savedAt, r.version])).toEqual([
        [6, 3],
        [3, 2],
        [1, 1],
      ]);
      expect((await lib.listVersions('m2'))[0].version).toBe(1);
    });

    it('continues numbering past the backfill on the next save', async () => {
      await seedTwoMaps();
      expect((await lib.saveVersion('m1', 'Alpha', json('new'), 'user')).version).toBe(4);
      expect((await lib.saveVersion('m2', 'Beta', json('new'), 'user')).version).toBe(2);
    });

    // The generator must resume above the highest id it inherits, or the first
    // save after the upgrade collides with a migrated row and its payload.
    it('mints post-upgrade ids above every id it inherited', async () => {
      const ids = await seedTwoMaps();
      const { id } = await lib.saveVersion('m1', 'Alpha', json('new'), 'user');
      expect(id).toBeGreaterThan(Math.max(...ids));
      expect(await lib.getPayload(id)).toBe(json('new'));
      // ...and nothing it inherited was overwritten on the way.
      for (const old of ids) expect(await lib.getPayload(old)).toBe(json(`payload-${old}`));
    });

    it('leaves a map with no versions alone rather than failing the upgrade', async () => {
      await seedV1([{ id: 'm1', name: 'Empty', updatedAt: 10 }], []);
      expect(await lib.listVersions('m1')).toEqual([]);
      expect((await lib.saveVersion('m1', 'Empty', json('1'), 'user')).version).toBe(1);
    });

    /**
     * A frozen second tab holding v1 open. Every tab running this module closes
     * on `versionchange`, so reaching this needs one that never got to — but the
     * cost of not handling it is a request that settles NEITHER way, i.e. a Save
     * menu that silently does nothing for good. v1 could never reach this: it
     * was the schema at creation, so no open request had an upgrade to block on.
     */
    it('fails loudly rather than hanging when another connection holds v1 open', async () => {
      await seedTwoMaps();
      const holder = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('massimo-library', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await expect(lib.listMaps()).rejects.toThrow(/another tab/);
      // ...and once it goes, a retry gets through: the rejection must not have
      // cached a dead connection, or the library would stay broken until reload.
      holder.close();
      expect(await lib.listVersions('m1')).toHaveLength(3);
    });

    it('drops the retired revisions store', async () => {
      await seedTwoMaps();
      await lib.listMaps(); // force the upgrade
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('massimo-library');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      expect([...db.objectStoreNames].sort()).toEqual(['maps', 'payloads', 'versions']);
      db.close();
    });

    // A v1 library upgrades straight through to the current schema, so the
    // createdAt backfill has to land on this path too — not just on v2 rows.
    it('backfills createdAt from the earliest surviving revision', async () => {
      await seedTwoMaps();
      const byId = new Map((await lib.listMaps()).map((m) => [m.id, m]));
      expect(byId.get('m1')?.createdAt).toBe(1);
      expect(byId.get('m2')?.createdAt).toBe(4);
    });
  });

  /**
   * The v2 schema (numbered versions, no map creation dates) also has real
   * libraries in it. v3 adds nothing structural — it stamps `createdAt` on
   * every map row, from the earliest surviving version's savedAt (pruning may
   * have taken older autos, so this is the best signal left).
   */
  describe('schema migration (v2 → v3)', () => {
    /** Build a v2 database by hand — the shape the v2 code actually wrote. */
    const seedV2 = (
      maps: { id: string; name: string; updatedAt: number; nextVersion: number }[],
      versions: { mapId: string; savedAt: number; source: string; version: number }[],
    ) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('massimo-library', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('maps', { keyPath: 'id' });
          const vs = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
          vs.createIndex('mapId', 'mapId', { unique: false });
          db.createObjectStore('payloads', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['maps', 'versions', 'payloads'], 'readwrite');
          for (const m of maps) tx.objectStore('maps').put(m);
          for (const v of versions) {
            const addReq = tx.objectStore('versions').add(v);
            addReq.onsuccess = () =>
              tx.objectStore('payloads').put({ id: addReq.result, json: json(`p`) });
          }
          tx.oncomplete = () => {
            // Close before the module opens at v3, or the upgrade parks on
            // `blocked` behind this handle and never settles.
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

    it('backfills createdAt from the earliest surviving version', async () => {
      await seedV2(
        [
          { id: 'm1', name: 'Alpha', updatedAt: 30, nextVersion: 3 },
          { id: 'm2', name: 'Beta', updatedAt: 40, nextVersion: 2 },
        ],
        [
          { mapId: 'm1', savedAt: 10, source: 'user', version: 1 },
          { mapId: 'm1', savedAt: 30, source: 'auto', version: 2 },
          { mapId: 'm2', savedAt: 40, source: 'user', version: 1 },
        ],
      );
      const byId = new Map((await lib.listMaps()).map((m) => [m.id, m]));
      expect(byId.get('m1')?.createdAt).toBe(10);
      expect(byId.get('m2')?.createdAt).toBe(40);
    });

    it('falls back to updatedAt for a map with no versions', async () => {
      await seedV2([{ id: 'm1', name: 'Empty', updatedAt: 30, nextVersion: 1 }], []);
      expect((await lib.listMaps())[0].createdAt).toBe(30);
    });

    it('leaves versions and counters untouched', async () => {
      await seedV2(
        [{ id: 'm1', name: 'Alpha', updatedAt: 30, nextVersion: 3 }],
        [
          { mapId: 'm1', savedAt: 10, source: 'user', version: 1 },
          { mapId: 'm1', savedAt: 30, source: 'auto', version: 2 },
        ],
      );
      expect((await lib.listVersions('m1')).map((r) => r.version)).toEqual([2, 1]);
      expect((await lib.saveVersion('m1', 'Alpha', json('new'), 'user')).version).toBe(3);
    });
  });

  it('mints a fresh unique map id', () => {
    expect(lib.newMapId()).not.toBe(lib.newMapId());
  });
});
