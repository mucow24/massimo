import { describe, it, expect, beforeEach } from 'vitest';
import {
  useLiveViewportStore,
  useViewportStore,
  nextGridSize,
  chromeIsDark,
  GRID_SIZES,
} from './viewportStore';

beforeEach(() => {
  localStorage.clear();
  useViewportStore.setState({
    x: 0,
    y: 0,
    zoom: 1,
    gridVisible: true,
    gridSize: 10,
    showWaypoints: false,
    // setState shallow-MERGES, so every persisted key has to be listed here or
    // it leaks across cases — a rehydrate test would then read whatever the
    // previous test left behind instead of the initializer's default.
    showAnchors: false,
    showNetwork: true,
    showLineCircles: true,
    showTransfers: true,
    showSvgImages: true,
    showTextLabels: true,
    showPolygons: true,
    showRouteBullets: true,
    dayCanvasColor: 'white',
    interfaceTheme: 'auto',
  });
});

describe('viewportStore — setViewport voids the live viewport', () => {
  it('clears any in-flight pending so a stale wheel settle cannot clobber an external jump', () => {
    // Reset view / sidebar centering / warning-toast jumps write the committed
    // camera directly while a wheel gesture's settle commit may still be
    // scheduled; the stale pending must die with the jump or the camera snaps
    // back up to 90ms later.
    useLiveViewportStore.getState().setPending({ x: 5, y: 5, zoom: 2 });
    useViewportStore.getState().setViewport({ x: 100, y: 50, zoom: 1 });
    expect(useLiveViewportStore.getState().pending).toBeNull();
  });
});

describe('viewportStore — gridSize', () => {
  it('defaults to a 10px grid', () => {
    // Assert the store's OWN initializer via getInitialState (the pristine
    // snapshot captured at creation), not getState() — the latter only reflects
    // what beforeEach just wrote, so it could never catch a broken default at
    // viewportStore.ts. Mirrors snapPrefs.test.ts.
    expect(useViewportStore.getInitialState().gridSize).toBe(10);
  });

  it('setGridSize updates the value', () => {
    useViewportStore.getState().setGridSize(5);
    expect(useViewportStore.getState().gridSize).toBe(5);
    useViewportStore.getState().setGridSize(10);
    expect(useViewportStore.getState().gridSize).toBe(10);
  });

  it('persists gridSize to localStorage (partialize)', () => {
    useViewportStore.getState().setGridSize(5);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.gridSize).toBe(5);
  });

  it('nextGridSize cycles 5 → 10 → 20 → 5', () => {
    expect(nextGridSize(5)).toBe(10);
    expect(nextGridSize(10)).toBe(20);
    expect(nextGridSize(20)).toBe(5);
  });

  it('nextGridSize falls back to the first size for an unknown value', () => {
    expect(nextGridSize(7)).toBe(GRID_SIZES[0]);
    expect(GRID_SIZES).toEqual([5, 10, 20]);
  });

  it('rehydrating a blob without gridSize leaves the live gridSize untouched', async () => {
    // A viewport saved before gridSize existed. There is no custom `merge`, so
    // zustand shallow-spreads the blob over live state: a key the blob omits is
    // not written at all, which on a real boot leaves the initializer's value
    // standing. What must never happen is the key arriving as undefined/NaN,
    // which would poison every snap.
    //
    // Seeded to a NON-default 20 on purpose. Asserting the default 10 here
    // would re-read what `beforeEach` just wrote and could not fail — and the
    // boot default is already pinned by the getInitialState test above.
    useViewportStore.setState({ gridSize: 20 });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.gridSize).toBe(20);
    expect(Number.isNaN(s.gridSize)).toBe(false);
    // A key the blob DOES carry still applies — so the line above is the
    // omitted key being preserved, not the whole rehydrate being ignored.
    expect(s.gridVisible).toBe(false);
  });
});

describe('viewportStore — showWaypoints', () => {
  it('defaults to off', () => {
    expect(useViewportStore.getInitialState().showWaypoints).toBe(false);
  });

  it('setShowWaypoints updates the value', () => {
    useViewportStore.getState().setShowWaypoints(true);
    expect(useViewportStore.getState().showWaypoints).toBe(true);
    useViewportStore.getState().setShowWaypoints(false);
    expect(useViewportStore.getState().showWaypoints).toBe(false);
  });

  it('persists showWaypoints to localStorage (partialize)', () => {
    useViewportStore.getState().setShowWaypoints(true);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.showWaypoints).toBe(true);
  });

  it('rehydrating a blob without showWaypoints leaves the live value untouched', async () => {
    // A viewport saved before showWaypoints existed. Seeded ON (the non-default)
    // so this observes the omitted key being preserved rather than re-reading
    // the `false` beforeEach already wrote; the boot default is pinned by the
    // getInitialState test above.
    useViewportStore.setState({ showWaypoints: true });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false, gridSize: 10 },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.showWaypoints).toBe(true);
    expect(s.showWaypoints).not.toBeUndefined();
    expect(s.gridVisible).toBe(false); // control: the rehydrate did apply
  });
});

describe('viewportStore — interfaceTheme', () => {
  it("defaults to 'auto': the chrome follows the map", () => {
    expect(useViewportStore.getInitialState().interfaceTheme).toBe('auto');
  });

  it('setInterfaceTheme updates the value', () => {
    useViewportStore.getState().setInterfaceTheme('dark');
    expect(useViewportStore.getState().interfaceTheme).toBe('dark');
    useViewportStore.getState().setInterfaceTheme('light');
    expect(useViewportStore.getState().interfaceTheme).toBe('light');
  });

  it('persists interfaceTheme to localStorage (partialize)', () => {
    useViewportStore.getState().setInterfaceTheme('dark');
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.interfaceTheme).toBe('dark');
  });

  it('rehydrating a blob without interfaceTheme leaves the live value untouched', async () => {
    // A viewport saved before interfaceTheme existed. Seeded to a non-default
    // so this observes the omitted key being preserved rather than re-reading
    // the 'auto' beforeEach already wrote; the boot default is pinned by the
    // getInitialState test above.
    useViewportStore.setState({ interfaceTheme: 'dark' });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false, gridSize: 10 },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.interfaceTheme).toBe('dark');
    expect(s.gridVisible).toBe(false); // control: the rehydrate did apply
  });

  // Same gate as the day paper: a stored theme the ladder doesn't offer has no
  // menu row to climb back out through, so it heals to the default on the way in.
  it('heals a stored theme the ladder does not offer back to the default', async () => {
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({ state: { interfaceTheme: 'sepia' }, version: 0 }),
    );
    await useViewportStore.persist.rehydrate();
    expect(useViewportStore.getState().interfaceTheme).toBe('auto');
  });
});

describe('chromeIsDark — the interface theme resolved against the map', () => {
  it("'auto' follows the map", () => {
    expect(chromeIsDark('auto', false)).toBe(false);
    expect(chromeIsDark('auto', true)).toBe(true);
  });

  it("'light' and 'dark' ignore the map", () => {
    expect(chromeIsDark('light', false)).toBe(false);
    expect(chromeIsDark('light', true)).toBe(false);
    expect(chromeIsDark('dark', false)).toBe(true);
    expect(chromeIsDark('dark', true)).toBe(true);
  });
});

describe('viewportStore — showNetwork', () => {
  it('defaults to on: a fresh session always opens with the map drawn', () => {
    expect(useViewportStore.getInitialState().showNetwork).toBe(true);
  });

  it('setShowNetwork updates the value', () => {
    useViewportStore.getState().setShowNetwork(false);
    expect(useViewportStore.getState().showNetwork).toBe(false);
    useViewportStore.getState().setShowNetwork(true);
    expect(useViewportStore.getState().showNetwork).toBe(true);
  });

  it('is deliberately NOT persisted, so a reload never opens onto a blank-looking map', () => {
    useViewportStore.getState().setShowNetwork(false);
    // Write a sibling that IS persisted in the same breath: it proves the blob
    // was really flushed, so showNetwork's absence below is partialize leaving
    // it out on purpose — not a test that raced the write.
    useViewportStore.getState().setGridSize(20);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!).state;
    expect(persisted.gridSize).toBe(20);
    expect('showNetwork' in persisted).toBe(false);
  });
});

describe('viewportStore — showAnchors', () => {
  // Anchors are scaffolding over finished artwork, so they default OFF like
  // waypoints. The gestures that NEED them visible reveal them by derivation
  // (state/anchorVisibility.ts) rather than by writing this flag.
  it('defaults to OFF', () => {
    expect(useViewportStore.getInitialState().showAnchors).toBe(false);
  });

  it('setShowAnchors updates the value', () => {
    useViewportStore.getState().setShowAnchors(true);
    expect(useViewportStore.getState().showAnchors).toBe(true);
    useViewportStore.getState().setShowAnchors(false);
    expect(useViewportStore.getState().showAnchors).toBe(false);
  });

  it('persists showAnchors to localStorage (partialize)', () => {
    useViewportStore.getState().setShowAnchors(true);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.showAnchors).toBe(true);
  });

  it('rehydrating a blob without showAnchors leaves the live value untouched', async () => {
    // Seeded ON (the non-default) so this observes the omitted key being
    // preserved rather than re-reading the `false` beforeEach already wrote;
    // the boot default is pinned by the getInitialState test above.
    useViewportStore.setState({ showAnchors: true });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false, gridSize: 10 },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.showAnchors).toBe(true);
    expect(s.showAnchors).not.toBeUndefined();
    expect(s.gridVisible).toBe(false); // control: the rehydrate did apply
  });
});

describe('viewportStore — the stored day-paper choice is judged on the way in', () => {
  const store = (dayCanvasColor: unknown) =>
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({ state: { dayCanvasColor }, version: 0 }),
    );

  it('keeps a paper the ladder still offers', async () => {
    store('gray');
    await useViewportStore.persist.rehydrate();
    expect(useViewportStore.getState().dayCanvasColor).toBe('gray');
  });

  // A paper the ladder no longer offers has no way back: nothing on the View
  // menu can name it, so it would sit in the store for good, painting the
  // fallback day palette while the menu shows a choice the user never made.
  it('heals a paper the ladder no longer offers back to the default', async () => {
    store('chartreuse');
    await useViewportStore.persist.rehydrate();
    expect(useViewportStore.getState().dayCanvasColor).toBe('white');
  });

  it('heals a paper of the wrong TYPE too — a blob is only ever JSON', async () => {
    store(3);
    await useViewportStore.persist.rehydrate();
    expect(useViewportStore.getState().dayCanvasColor).toBe('white');
  });

  it('leaves the live paper alone when the blob predates the field', async () => {
    useViewportStore.setState({ dayCanvasColor: 'black' });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({ state: { gridVisible: false }, version: 0 }),
    );
    await useViewportStore.persist.rehydrate();
    expect(useViewportStore.getState().dayCanvasColor).toBe('black');
    expect(useViewportStore.getState().gridVisible).toBe(false); // control
  });
});
