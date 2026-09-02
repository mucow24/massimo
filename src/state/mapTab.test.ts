import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

/**
 * The tab's relationship to its map, against real page loads: `boot()`
 * re-imports the state modules with `vi.resetModules()`, so persist
 * rehydration, the baseline boot and the pointer's URL read all run exactly as
 * they do in the app. localStorage, the URL and the fake-indexeddb factory
 * survive the "reload"; the module registry does not — the same split a
 * browser refresh makes.
 */

interface Boot {
  store: typeof import('./store');
  sb: typeof import('./saveBaseline');
  lp: typeof import('./libraryPointer');
  lib: typeof import('./mapLibrary');
  tab: typeof import('./mapTab');
  keys: typeof import('./mapKeys');
  vp: typeof import('./viewportStore');
  ser: typeof import('../model/serialize');
}

const boot = async (): Promise<Boot> => {
  window.dispatchEvent(new window.Event('pagehide'));
  vi.resetModules();
  return {
    store: await import('./store'),
    sb: await import('./saveBaseline'),
    lp: await import('./libraryPointer'),
    lib: await import('./mapLibrary'),
    tab: await import('./mapTab'),
    keys: await import('./mapKeys'),
    vp: await import('./viewportStore'),
    ser: await import('../model/serialize'),
  };
};

const setUrl = (hash: string) => window.history.replaceState(null, '', hash);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  localStorage.clear();
  setUrl('#map=a');
});

const statusNow = (m: Boot) =>
  m.sb.saveStatusOf(m.store.useDoc.getState(), m.sb.useSaveBaseline.getState());
const stationCount = (m: Boot) => Object.keys(m.store.useDoc.getState().stations).length;

/** Save to the library exactly as Toolbar's onSaveToLibrary does. */
const save = async (m: Boot) => {
  const doc = m.store.useDoc.getState();
  const snap = m.store.pickDocSnapshot(doc);
  const json = m.ser.serialize(snap);
  const mapId = m.lp.useLibraryPointer.getState().mapId;
  const saved = await m.lib.saveVersion(mapId, doc.name, json, 'user');
  m.lp.useLibraryPointer.getState().setPointer(mapId, saved.version);
  m.sb.markSaved(json, snap);
  return saved;
};

describe('openTabMapFromLibrary — coming up on a map with no working copy', () => {
  it('a reload after a clean save comes back on the saved version, from the library', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await save(m1);
    expect(m1.keys.hasDocDraft('a')).toBe(false); // the save released the copy

    const m2 = await boot();
    expect(stationCount(m2)).toBe(0); // nothing in the slot to hydrate from
    await m2.tab.openTabMapFromLibrary();
    expect(stationCount(m2)).toBe(1);
    expect(statusNow(m2)).toBe('clean');
    expect(m2.lp.useLibraryPointer.getState()).toMatchObject({ mapId: 'a', version: 1 });
  });

  it('comes up on the version the pointer names, not the newest', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await save(m1); // v1: one station
    m1.store.useDoc.getState().addStation(100, 0);
    await save(m1); // v2: two
    // The canvas came from v1 (opened from the library, say), and the slot
    // recorded that.
    m1.lp.useLibraryPointer.getState().setPointer('a', 1);

    const m2 = await boot();
    await m2.tab.openTabMapFromLibrary();
    expect(stationCount(m2)).toBe(1);
    expect(m2.lp.useLibraryPointer.getState().version).toBe(1);
  });

  it('a working copy wins over the library — unsaved work is never fetched over', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await save(m1);
    m1.store.useDoc.getState().addStation(100, 0); // unsaved: the slot holds it

    const m2 = await boot();
    await m2.tab.openTabMapFromLibrary();
    expect(stationCount(m2)).toBe(2);
    expect(statusNow(m2)).toBe('dirty');
  });

  it('a map the library has nothing for stays the empty doc the boot gave it', async () => {
    const m = await boot();
    await m.tab.openTabMapFromLibrary();
    expect(stationCount(m)).toBe(0);
    expect(statusNow(m)).toBe('unsaved');
  });
});

describe('switchTabToMap — becoming another map and coming up on it', () => {
  it('comes up on the target’s working copy, dirty, when a closed window left one', async () => {
    const onA = await boot();
    onA.store.useDoc.getState().addStation(0, 0); // left unsaved; the window closes
    setUrl('#map=b');
    const onB = await boot();
    expect(stationCount(onB)).toBe(0);

    await onB.tab.switchTabToMap('a');
    expect(onB.lp.useLibraryPointer.getState().mapId).toBe('a');
    expect(window.location.hash).toBe('#map=a');
    expect(stationCount(onB)).toBe(1);
    expect(statusNow(onB)).toBe('dirty');
  });

  it('comes up on the target’s library version when it has no working copy', async () => {
    const onA = await boot();
    onA.store.useDoc.getState().addStation(0, 0);
    await save(onA);
    setUrl('#map=b');
    const onB = await boot();

    await onB.tab.switchTabToMap('a');
    expect(stationCount(onB)).toBe(1);
    expect(statusNow(onB)).toBe('clean');
    expect(onB.lp.useLibraryPointer.getState()).toMatchObject({ mapId: 'a', version: 1 });
  });

  it('restores the target’s own camera', async () => {
    const onA = await boot();
    onA.vp.useViewportStore.getState().setViewport({ x: 42, y: 7, zoom: 3 });
    onA.store.useDoc.getState().addStation(0, 0);
    setUrl('#map=b');
    const onB = await boot();
    onB.vp.useViewportStore.getState().setViewport({ x: -1, y: -1, zoom: 0.5 });

    await onB.tab.switchTabToMap('a');
    expect(onB.vp.useViewportStore.getState()).toMatchObject({ x: 42, y: 7, zoom: 3 });
  });
});

describe('becomeMap — the outgoing map’s working copy', () => {
  it('goes when it holds nothing unsaved (an untouched file or New)', async () => {
    const m = await boot();
    m.store.useDoc.getState().addStation(0, 0);
    const snap = m.store.pickDocSnapshot(m.store.useDoc.getState());
    m.sb.markAdopted(m.ser.serialize(snap), snap); // a loaded file: clean, unbacked
    expect(m.keys.hasDocDraft('a')).toBe(true);
    await m.tab.becomeMap('b');
    expect(m.keys.hasDocDraft('a')).toBe(false);
    expect(m.lp.useLibraryPointer.getState().mapId).toBe('b');
  });

  it('stays when it holds unsaved work', async () => {
    const m = await boot();
    m.store.useDoc.getState().addStation(0, 0); // dirty, and the caller skipped its auto-save
    await m.tab.becomeMap('b');
    expect(m.keys.hasDocDraft('a')).toBe(true);
  });

  it('moves the pointer to the version the target’s own slot records', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await save(m1); // a is at v1
    await m1.tab.becomeMap('b');
    expect(m1.lp.useLibraryPointer.getState()).toMatchObject({ mapId: 'b', version: null });
    await m1.tab.becomeMap('a');
    expect(m1.lp.useLibraryPointer.getState()).toMatchObject({ mapId: 'a', version: 1 });
  });
});

describe('becomeMap — one editing window per map', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });

  it('refuses a map another window holds, and stays where it was', async () => {
    const taken = new Set(['massimo-map:a']);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (name: string, opts: unknown, cb?: (lock: unknown) => unknown) => {
          const fn = (typeof opts === 'function' ? opts : cb) as (lock: unknown) => unknown;
          return Promise.resolve().then(() => fn(taken.has(name) ? null : { name }));
        },
      },
    });
    setUrl('#map=b');
    const m = await boot();
    await expect(m.tab.becomeMap('a')).rejects.toThrow(m.tab.MAP_BUSY);
    expect(m.lp.useLibraryPointer.getState().mapId).toBe('b');
    expect(window.location.hash).toBe('#map=b');
  });
});

describe('retargetTab — the same document under a new identity', () => {
  it('moves the working copy and the camera, and the pointer follows', async () => {
    const m = await boot();
    m.store.useDoc.getState().addStation(0, 0);
    m.vp.useViewportStore.getState().setViewport({ x: 5, y: 6, zoom: 2 });
    await m.tab.retargetTab('c');
    expect(m.keys.hasDocDraft('a')).toBe(false);
    expect(m.keys.hasDocDraft('c')).toBe(true);
    expect(localStorage.getItem(m.keys.cameraKey('a'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(m.keys.cameraKey('c'))!).state).toEqual({
      x: 5,
      y: 6,
      zoom: 2,
    });
    expect(m.lp.useLibraryPointer.getState()).toMatchObject({ mapId: 'c', version: null });
    expect(window.location.hash).toBe('#map=c');
    // The canvas never blinked.
    expect(stationCount(m)).toBe(1);
  });
});

describe('the library-at-boot request', () => {
  it('is consumed once', async () => {
    const m = await boot();
    expect(m.tab.takeLibraryAtBootRequest()).toBe(false);
    m.tab.requestLibraryAtBoot();
    expect(m.tab.takeLibraryAtBootRequest()).toBe(true);
    expect(m.tab.takeLibraryAtBootRequest()).toBe(false);
  });
});
