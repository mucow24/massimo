import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeStation } from '../test/fixtures';

// jsdom reports clientWidth/clientHeight as 0, which collapses the canvas
// viewBox and leaves every query matching nothing whether the code works or
// not. Give the host a real size, restoring it after.
const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, showNetwork: true, showAnchors: true });
  useSelection.setState({
    selectedStationIds: [],
    selectedAnchorIds: [],
    uiMode: { kind: 'idle' },
  });
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

const seed = () =>
  act(() => {
    useDoc.getState().loadDoc(
      makeDoc({
        stations: [
          makeStation({ id: 's1', x: 0, y: 0, transferAnchors: [{ id: 'h1', row: 0, col: 1 }] }),
        ],
        transferAnchors: [{ id: 'a1', x: 120, y: 40 }],
      }),
    );
  });

const freeAnchors = () => document.querySelectorAll('[data-anchor-id]');
const allDiscs = () => document.querySelectorAll('[data-anchor-disc]');

describe('MapCanvas — transfer anchors', () => {
  it('paints both a free and a station-hosted anchor', () => {
    render(<App />);
    seed();
    expect(allDiscs().length).toBe(2);
    // Only the free one is addressable — hosted anchors are station internals.
    expect(freeAnchors().length).toBe(1);
  });

  it('keeps the whole layer out of exports', () => {
    // Anchors are scaffolding; the transfer bound to one is the artwork. The
    // export pipeline strips [data-export-exclude] subtrees from the clone, so
    // sitting inside one is what keeps an anchor off every SVG/PNG/PDF.
    render(<App />);
    seed();
    for (const disc of allDiscs()) {
      expect(disc.closest('[data-export-exclude]')).not.toBeNull();
    }
  });

  it('hides every anchor when the anchor toggle is off', () => {
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowAnchors(false));
    expect(allDiscs().length).toBe(0);
  });

  it('hides anchors with the rest of the network', () => {
    // Anchors are part of the transfer network, and every transfer surface is
    // showNetwork-gated — an anchor floating alone over hidden art is noise.
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowNetwork(false));
    expect(allDiscs().length).toBe(0);
  });

  it('hiding is a PEEK, not a deselect', () => {
    // Same contract the station toggle is pinned to: the selection survives, so
    // toggling back doesn't silently lose what was armed.
    render(<App />);
    seed();
    act(() => useSelection.getState().setAnchorSelection(['a1']));
    act(() => useViewportStore.getState().setShowAnchors(false));
    expect(useSelection.getState().selectedAnchorIds).toEqual(['a1']);
  });
});

// THE test that should have existed first: draw a transfer to an anchor by
// CLICKING it on the canvas. The model layer accepted {stationId, anchorId}
// ends from day one and was unit-tested; the rendered station anchor was inert,
// so the feature's headline gesture never worked.
describe('MapCanvas — clicking an anchor to draw a transfer', () => {
  const enterTransferMode = () =>
    act(() => useSelection.getState().setUiMode({ kind: 'creating-transfer', firstEnd: null }));

  const clickAnchor = (el: Element) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  const hostedDisc = () =>
    document.querySelector('[data-anchor-station="s1"][data-anchor-cell="h1"] [data-anchor-disc]')!;
  const freeDisc = () => document.querySelector('[data-anchor-id="a1"] [data-anchor-disc]')!;

  it('starts a transfer from a STATION-HOSTED anchor', () => {
    render(<App />);
    seed();
    enterTransferMode();
    expect(hostedDisc()).toBeTruthy();
    clickAnchor(hostedDisc());
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'creating-transfer',
      firstEnd: { stationId: 's1', anchorId: 'h1' },
    });
  });

  it('completes a transfer from a hosted anchor to a free anchor', () => {
    render(<App />);
    seed();
    enterTransferMode();
    clickAnchor(hostedDisc());
    clickAnchor(freeDisc());
    const transfers = Object.values(useDoc.getState().transfers);
    expect(transfers).toHaveLength(1);
    expect([transfers[0].a, transfers[0].b]).toEqual([
      { stationId: 's1', anchorId: 'h1' },
      { anchorId: 'a1' },
    ]);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('reveals anchors for the transfer gesture even while the toggle is OFF', () => {
    // Anchors default hidden now, so the mode has to surface them itself — an
    // anchor you cannot see is an anchor you cannot pick.
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowAnchors(false));
    expect(document.querySelectorAll('[data-anchor-disc]')).toHaveLength(0);
    enterTransferMode();
    expect(document.querySelectorAll('[data-anchor-disc]')).toHaveLength(2);
  });

  it('hides them again once the transfer is committed', () => {
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowAnchors(false));
    enterTransferMode();
    clickAnchor(hostedDisc());
    clickAnchor(freeDisc());
    expect(document.querySelectorAll('[data-anchor-disc]')).toHaveLength(0);
  });

  it('hides them again when the mode is cancelled', () => {
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowAnchors(false));
    enterTransferMode();
    act(() => useSelection.getState().setUiMode({ kind: 'idle' }));
    expect(document.querySelectorAll('[data-anchor-disc]')).toHaveLength(0);
  });

  it('reveals anchors while PLACING one, so you can see where the others are', () => {
    render(<App />);
    seed();
    act(() => useViewportStore.getState().setShowAnchors(false));
    act(() => useSelection.getState().setUiMode({ kind: 'placing-anchor' }));
    expect(document.querySelectorAll('[data-anchor-disc]').length).toBeGreaterThan(0);
  });

  it('leaves a hosted anchor click-through in idle, so it never steals a station click', () => {
    render(<App />);
    seed();
    const disc = hostedDisc();
    expect(disc.getAttribute('pointer-events')).toBe('none');
  });
});

// Anchors are hidden by default, which left no way to see what a station
// carries short of flipping a global toggle (and then flipping it back). Looking
// at a station — pointing at it, or selecting it — now reveals ITS anchors, and
// only its own.
describe('MapCanvas — a station reveals its own anchors on hover / selection', () => {
  const seedPair = () => {
    act(() => {
      useDoc.getState().loadDoc(
        makeDoc({
          stations: [
            makeStation({ id: 's1', x: 0, y: 0, transferAnchors: [{ id: 'h1', row: 0, col: 1 }] }),
            makeStation({
              id: 's2',
              x: 300,
              y: 0,
              transferAnchors: [{ id: 'h2', row: 0, col: 1 }],
            }),
          ],
          transferAnchors: [{ id: 'a1', x: 120, y: 40 }],
        }),
      );
    });
    act(() => useViewportStore.getState().setShowAnchors(false));
    act(() => useSelection.getState().setHoveredCanvasItem(null));
  };

  const hostedOf = (sid: string) =>
    document.querySelectorAll(`[data-anchor-station="${sid}"] [data-anchor-disc]`);
  const hover = (sid: string | null) =>
    act(() =>
      useSelection.getState().setHoveredCanvasItem(sid ? { kind: 'station', id: sid } : null),
    );

  it('shows the hovered station’s anchors with the toggle off', () => {
    render(<App />);
    seedPair();
    expect(allDiscs()).toHaveLength(0);
    hover('s1');
    expect(hostedOf('s1')).toHaveLength(1);
  });

  it('shows a selected station’s anchors', () => {
    render(<App />);
    seedPair();
    act(() => useSelection.getState().selectStation('s1' as never));
    expect(hostedOf('s1')).toHaveLength(1);
  });

  it('reveals ONLY that station’s anchors — not a neighbour’s, not the free ones', () => {
    // The headline of the request: the whole point is to see one station's
    // anchors without lighting up the entire network.
    render(<App />);
    seedPair();
    hover('s1');
    expect(hostedOf('s2')).toHaveLength(0);
    expect(freeAnchors()).toHaveLength(0);
  });

  it('hides them again when the pointer leaves', () => {
    render(<App />);
    seedPair();
    hover('s1');
    hover(null);
    expect(allDiscs()).toHaveLength(0);
  });

  it('leaves the revealed anchors click-through', () => {
    // Pure display: revealing an anchor must not put a new pointer surface over
    // the station under it, or hovering a station would stop you clicking it.
    render(<App />);
    seedPair();
    hover('s1');
    expect(hostedOf('s1')[0].getAttribute('pointer-events')).toBe('none');
  });

  it('stays hidden with the network toggled off', () => {
    // Anchors go with the rest of the transfer network; a reveal must not be a
    // back door around that.
    render(<App />);
    seedPair();
    act(() => useViewportStore.getState().setShowNetwork(false));
    hover('s1');
    expect(allDiscs()).toHaveLength(0);
  });
});

describe('MapCanvas — anchor hover highlight while picking transfer ends', () => {
  const enterTransferMode = () =>
    act(() => useSelection.getState().setUiMode({ kind: 'creating-transfer', firstEnd: null }));

  const hostedGroup = () =>
    document.querySelector('[data-anchor-station="s1"][data-anchor-cell="h1"]')!;
  const freeGroup = () => document.querySelector('[data-anchor-id="a1"]')!;
  const hoverRing = (g: Element) => g.querySelector('[data-anchor-hover]');

  const enter = (g: Element) =>
    act(() => {
      g.querySelector('[data-anchor-disc]')!.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true }),
      );
    });
  const leave = (g: Element) =>
    act(() => {
      g.querySelector('[data-anchor-disc]')!.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true }),
      );
    });

  it('rings a hovered STATION-HOSTED anchor', () => {
    render(<App />);
    seed();
    enterTransferMode();
    expect(hoverRing(hostedGroup())).toBeNull();
    enter(hostedGroup());
    expect(hoverRing(hostedGroup())).not.toBeNull();
  });

  it('rings a hovered FREE anchor', () => {
    render(<App />);
    seed();
    enterTransferMode();
    enter(freeGroup());
    expect(hoverRing(freeGroup())).not.toBeNull();
  });

  it('clears the ring on pointer-out', () => {
    render(<App />);
    seed();
    enterTransferMode();
    enter(hostedGroup());
    leave(hostedGroup());
    expect(hoverRing(hostedGroup())).toBeNull();
  });

  it('rings only the anchor under the cursor', () => {
    render(<App />);
    seed();
    enterTransferMode();
    enter(freeGroup());
    expect(hoverRing(freeGroup())).not.toBeNull();
    expect(hoverRing(hostedGroup())).toBeNull();
  });

  it('drops the ring when the mode exits, with no pointer-out to clear it', () => {
    // Committing or cancelling unmounts the anchor under the cursor, so no
    // pointerout ever fires — the mode transition has to clear the channel or
    // the ring reappears the next time anchors are shown.
    render(<App />);
    seed();
    enterTransferMode();
    enter(hostedGroup());
    act(() => useSelection.getState().setUiMode({ kind: 'idle' }));
    expect(useSelection.getState().hoveredAnchorKey).toBeNull();
  });

  it('paints a TWO-TONE ring whose tones flip with the theme', () => {
    // A single-color ring vanishes against one background or the other; the
    // shared two-tone recipe (underlay + ink core) reads on both.
    render(<App />);
    seed();
    enterTransferMode();
    enter(hostedGroup());
    const light = [...hostedGroup().querySelectorAll('[data-anchor-hover]')].map((n) =>
      n.getAttribute('stroke'),
    );
    expect(light).toHaveLength(2);
    expect(light[0]).not.toBe(light[1]);

    act(() => useDoc.getState().setDarkMode(true));
    const dark = [...hostedGroup().querySelectorAll('[data-anchor-hover]')].map((n) =>
      n.getAttribute('stroke'),
    );
    expect(dark).toEqual([light[1], light[0]]);
  });

  it('does not ring anchors in idle mode', () => {
    render(<App />);
    seed();
    enter(freeGroup());
    expect(hoverRing(freeGroup())).toBeNull();
  });
});
