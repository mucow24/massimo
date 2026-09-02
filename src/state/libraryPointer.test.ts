import { describe, it, expect, beforeEach, vi } from 'vitest';
import { baselineKey, cameraKey, docKey, pointerKey } from './mapKeys';

/**
 * The store reads the URL and the legacy keys at creation, so each test needs
 * a fresh module against a freshly-seeded localStorage and URL. The URL is set
 * with replaceState, never `location.hash =`: assigning the hash fires
 * `hashchange`, which the module answers with a reload.
 */
type Mod = typeof import('./libraryPointer');
const load = async (): Promise<Mod> => {
  vi.resetModules();
  return import('./libraryPointer');
};

const setUrl = (hash: string) => window.history.replaceState(null, '', hash || '/');

beforeEach(() => {
  localStorage.clear();
  setUrl('');
});

describe('libraryPointer — the tab is ON a map', () => {
  it('takes its map from the URL fragment', async () => {
    setUrl('#map=abc');
    const { useLibraryPointer, bootedWithoutMap } = await load();
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'abc', version: null });
    expect(bootedWithoutMap).toBe(false);
  });

  it('mints a map for a bare URL and names it in the URL', async () => {
    const { useLibraryPointer, bootedWithoutMap } = await load();
    const { mapId } = useLibraryPointer.getState();
    expect(mapId).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.location.hash).toBe(`#map=${mapId}`);
    expect(bootedWithoutMap).toBe(true);
  });

  it('setPointer moves the URL to the new map', async () => {
    setUrl('#map=a');
    const { useLibraryPointer, tabMapId } = await load();
    useLibraryPointer.getState().setPointer('b', null);
    expect(window.location.hash).toBe('#map=b');
    expect(tabMapId()).toBe('b');
  });

  it('a bare setState moves the key source and the URL too', async () => {
    setUrl('#map=a');
    const { useLibraryPointer, tabMapId } = await load();
    useLibraryPointer.setState({ mapId: 'c' });
    expect(tabMapId()).toBe('c');
    expect(window.location.hash).toBe('#map=c');
  });

  it('persists the version PER MAP, so two maps never read each other’s number', async () => {
    setUrl('#map=a');
    const first = await load();
    first.useLibraryPointer.getState().setPointer('a', 3);
    first.useLibraryPointer.getState().setPointer('b', null);
    // Reload on b: nothing saved under it yet.
    const onB = await load();
    expect(onB.useLibraryPointer.getState()).toMatchObject({ mapId: 'b', version: null });
    // Back to a: its own number, untouched by b.
    setUrl('#map=a');
    const onA = await load();
    expect(onA.useLibraryPointer.getState()).toMatchObject({ mapId: 'a', version: 3 });
  });

  it('the persisted blob carries no map id — the id is the key', async () => {
    setUrl('#map=a');
    const { useLibraryPointer } = await load();
    useLibraryPointer.getState().setPointer('a', 5);
    expect(localStorage.getItem(pointerKey('a'))).not.toContain('mapId');
    expect(JSON.parse(localStorage.getItem(pointerKey('a'))!).state).toEqual({ version: 5 });
  });

  it('ignores an unparseable persisted blob rather than throwing', async () => {
    setUrl('#map=a');
    localStorage.setItem(pointerKey('a'), '{not json');
    const { useLibraryPointer } = await load();
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'a', version: null });
  });

  it('tabHashDiverged reads whether the URL still names this tab’s map', async () => {
    setUrl('#map=a');
    const { tabHashDiverged } = await load();
    expect(tabHashDiverged()).toBe(false);
    setUrl('#map=b');
    expect(tabHashDiverged()).toBe(true);
    setUrl('#map=a');
    expect(tabHashDiverged()).toBe(false);
  });
});

/**
 * The first boot of this build on a browser that kept ONE working copy for
 * the whole app. That document must come up exactly as it was left — under
 * its map, with its version, its baseline and its camera — and the old keys
 * must go, so this can only ever happen once.
 */
describe('libraryPointer — adopting the pre-per-map storage', () => {
  const seedLegacy = (pointer: unknown) => {
    localStorage.setItem('vignelli-map-doc-v1', '{"state":{"name":"Old map"},"version":30}');
    if (pointer !== undefined)
      localStorage.setItem('massimo-library-pointer', JSON.stringify(pointer));
    localStorage.setItem('massimo-save-baseline', '{"h":"12.abc","backed":true}');
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 10, y: 20, zoom: 2, gridSize: 20, showAnchors: true },
        version: 0,
      }),
    );
  };

  it('moves the document, version, baseline and camera under the pointed map', async () => {
    seedLegacy({ state: { mapId: 'old', version: 7 }, version: 0 });
    const { useLibraryPointer, bootedWithoutMap } = await load();
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'old', version: 7 });
    expect(bootedWithoutMap).toBe(false);
    expect(window.location.hash).toBe('#map=old');
    expect(localStorage.getItem(docKey('old'))).toBe('{"state":{"name":"Old map"},"version":30}');
    expect(localStorage.getItem(baselineKey('old'))).toBe('{"h":"12.abc","backed":true}');
    expect(JSON.parse(localStorage.getItem(cameraKey('old'))!).state).toEqual({
      x: 10,
      y: 20,
      zoom: 2,
    });
    // The view preferences stay global, and the camera has left them.
    expect(JSON.parse(localStorage.getItem('massimo-viewport')!).state).toEqual({
      gridSize: 20,
      showAnchors: true,
    });
  });

  it('retires the legacy keys, so adoption can only happen once', async () => {
    seedLegacy({ state: { mapId: 'old', version: 7 }, version: 0 });
    await load();
    expect(localStorage.getItem('vignelli-map-doc-v1')).toBeNull();
    expect(localStorage.getItem('massimo-library-pointer')).toBeNull();
    expect(localStorage.getItem('massimo-save-baseline')).toBeNull();
    // A second boot on a bare URL is a plain bare boot: nothing left to adopt.
    setUrl('');
    const { bootedWithoutMap } = await load();
    expect(bootedWithoutMap).toBe(true);
  });

  it('a legacy document with no map id (a loaded file) gets a minted identity', async () => {
    seedLegacy({ state: { mapId: null, version: null }, version: 0 });
    const { useLibraryPointer } = await load();
    const { mapId, version } = useLibraryPointer.getState();
    expect(mapId).toMatch(/^[0-9a-f-]{36}$/);
    expect(version).toBeNull();
    expect(localStorage.getItem(docKey(mapId))).toContain('Old map');
  });

  it('wins over the URL: the document belongs to the map the old pointer named', async () => {
    setUrl('#map=bookmarked');
    seedLegacy({ state: { mapId: 'old', version: 7 }, version: 0 });
    const { useLibraryPointer } = await load();
    expect(useLibraryPointer.getState().mapId).toBe('old');
    expect(window.location.hash).toBe('#map=old');
  });
});
