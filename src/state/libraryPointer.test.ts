import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The store reads the legacy key at creation, so each test needs a fresh
 * module against a freshly-seeded localStorage.
 */
type Mod = typeof import('./libraryPointer');
const load = async (): Promise<Mod> => {
  vi.resetModules();
  return import('./libraryPointer');
};

const POINTER_KEY = 'massimo-library-pointer';
const LEGACY_KEY = 'massimo-library-current';

beforeEach(() => {
  localStorage.clear();
});

describe('libraryPointer', () => {
  it('starts empty', async () => {
    const { useLibraryPointer } = await load();
    expect(useLibraryPointer.getState().mapId).toBeNull();
    expect(useLibraryPointer.getState().version).toBeNull();
  });

  it('round-trips a map id and version', async () => {
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', 32);
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 32 });
  });

  it('persists across a reload', async () => {
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', 32);
    const reloaded = await load();
    expect(reloaded.useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 32 });
  });

  /**
   * A brand-new map (Canvas → New) has an id but nothing saved under it yet, so
   * there is no version to show. Distinct from a loaded JSON file, which has
   * neither.
   */
  it('carries a map id with no version yet', async () => {
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', null);
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: null });
  });

  it('clears both halves together', async () => {
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', 32);
    useLibraryPointer.getState().setPointer(null, null);
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: null, version: null });
  });

  /**
   * #265 kept the pointer as a bare string under its own key. A user who has
   * been saving all afternoon must not have their live document fork a new map
   * on its next save just because the pointer moved house.
   */
  it('adopts the pre-store pointer key', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-map');
    const { useLibraryPointer } = await load();
    expect(useLibraryPointer.getState().mapId).toBe('legacy-map');
    // Nothing recorded which version that document came from, and inventing one
    // would put a wrong number in the toolbar.
    expect(useLibraryPointer.getState().version).toBeNull();
  });

  it('retires the legacy key once it has been adopted', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-map');
    await load();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  /**
   * Adoption has to be WRITTEN, not just held.
   *
   * `persist` only writes on a change, and skips the initial state when storage
   * is empty — so an id adopted into the initial state lives in memory only.
   * Retire the legacy key alongside that and the id is gone on the next reload:
   * boot the app once, refresh without saving, and the next save forks a new map
   * exactly as if adoption had never happened. The failure needs a reload to
   * show, which is precisely why the adopt-and-retire tests above both pass
   * while the data is being lost.
   */
  it('keeps an adopted pointer across the NEXT reload, with nothing saved in between', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-map');
    const first = await load();
    expect(first.useLibraryPointer.getState().mapId).toBe('legacy-map');
    const reloaded = await load();
    expect(reloaded.useLibraryPointer.getState().mapId).toBe('legacy-map');
  });

  it('prefers a real persisted pointer over a stale legacy key', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-map');
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', 5);
    localStorage.setItem(LEGACY_KEY, 'legacy-map'); // as if never retired
    const reloaded = await load();
    expect(reloaded.useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 5 });
  });

  /**
   * The trap the old bare-string key set: `setItem(k, null)` stores the STRING
   * "null", which is truthy and survives `??`, so `mapId ?? newMapId()` hands
   * back "null" and every file loaded thereafter writes into one shared bogus
   * map. JSON storage makes it structurally impossible — this pins that.
   */
  it('stores a real null, never the string "null"', async () => {
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('m1', 32);
    useLibraryPointer.getState().setPointer(null, null);
    const reloaded = await load();
    expect(reloaded.useLibraryPointer.getState().mapId).toBeNull();
    expect(reloaded.useLibraryPointer.getState().mapId ?? 'minted').toBe('minted');
    expect(localStorage.getItem(POINTER_KEY)).toContain('"mapId":null');
  });

  it('ignores an unparseable persisted blob rather than throwing', async () => {
    localStorage.setItem(POINTER_KEY, '{not json');
    const { useLibraryPointer } = await load();
    expect(useLibraryPointer.getState().mapId).toBeNull();
  });
});
