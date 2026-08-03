import { describe, it, expect, beforeEach } from 'vitest';
import { useLiveViewportStore, useViewportStore, nextGridSize, GRID_SIZES } from './viewportStore';

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
    darkUiInDay: false,
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

describe('viewportStore — darkUiInDay', () => {
  it('defaults to off: a day map opens with light chrome', () => {
    expect(useViewportStore.getInitialState().darkUiInDay).toBe(false);
  });

  it('setDarkUiInDay updates the value', () => {
    useViewportStore.getState().setDarkUiInDay(true);
    expect(useViewportStore.getState().darkUiInDay).toBe(true);
    useViewportStore.getState().setDarkUiInDay(false);
    expect(useViewportStore.getState().darkUiInDay).toBe(false);
  });

  it('persists darkUiInDay to localStorage (partialize)', () => {
    useViewportStore.getState().setDarkUiInDay(true);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.darkUiInDay).toBe(true);
  });

  it('rehydrating a blob without darkUiInDay leaves the live value untouched', async () => {
    // A viewport saved before darkUiInDay existed. Seeded ON (the non-default)
    // so this observes the omitted key being preserved rather than re-reading
    // the `false` beforeEach already wrote; the boot default is pinned by the
    // getInitialState test above.
    useViewportStore.setState({ darkUiInDay: true });
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false, gridSize: 10 },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.darkUiInDay).toBe(true);
    expect(s.darkUiInDay).not.toBeUndefined();
    expect(s.gridVisible).toBe(false); // control: the rehydrate did apply
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
