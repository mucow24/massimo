// Item popovers are pinned to the top-right corner of what's visible of the
// host — the same dock the line editor and the station layout editor use —
// instead of spawning beside the item and tracking the canvas. The pin is
// screen-space: it ignores the item, ignores pan/zoom, and only moves for the
// open sidebar (which overlays the host's right strip), the host box itself,
// and the window's slice of a host too wide to fit it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { ItemPopovers } from './ItemPopovers';
import { useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useLiveViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import type { RouteBullet } from '../../model/types';

// zoom 1, centered on the world origin: world (0,0) projects to screen (400,300).
const committedView = { vbX: -400, vbY: -300, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

const SEL = '.bullet-popover';

const bullet: RouteBullet = {
  id: 'b1',
  x: 0,
  y: 0,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 10,
};

function leftTop(): { left: number; top: number } {
  const el = document.querySelector(SEL) as HTMLElement | null;
  if (!el) throw new Error('popover not rendered');
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

// jsdom reports offsetWidth 0, so the pin falls back to the nominal 320 panel
// width; stubWidth exercises the measured path (item popovers are 248 wide).
function stubWidth(px: number): () => void {
  const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.style.display === 'none' ? 0 : px;
    },
  });
  return () => Object.defineProperty(HTMLElement.prototype, 'offsetWidth', orig);
}

// The host's top edge in the window: the app's 44px toolbar row sits above it,
// and a window-anchored dock has to carry that offset (an unstubbed jsdom rect
// is all zeros, which is why the tests above expect a bare 8).
const HOST_TOP = 44;

// Page-scroll simulation. `.toolbar { min-width: max-content }` floors the app
// grid — and with it the canvas host — at the toolbar's natural width, so a
// narrower window leaves the host wider than the window and the PAGE scrolls
// horizontally. What the dock reads is the host's box IN THE WINDOW, and
// scrolling right slides that box left to a negative `left`. jsdom has no
// layout (every rect is zeros, every clientWidth 0), so stub both and dispatch
// the scroll event the browser would fire.
function stubPage(windowW: number): { scrollTo: (x: number) => void; restore: () => void } {
  const docEl = document.documentElement;
  const origW = Object.getOwnPropertyDescriptor(docEl, 'clientWidth');
  // getBoundingClientRect lives on Element, not HTMLElement.
  const origRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
  let x = 0;
  Object.defineProperty(docEl, 'clientWidth', { configurable: true, get: () => windowW });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: -x, top: HOST_TOP, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  return {
    scrollTo: (to: number) => {
      x = to;
      fireEvent.scroll(window);
    },
    restore: () => {
      if (origW) Object.defineProperty(docEl, 'clientWidth', origW);
      else delete (docEl as unknown as Record<string, unknown>).clientWidth;
      Object.defineProperty(Element.prototype, 'getBoundingClientRect', origRect);
    },
  };
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, routeBullets: { b1: bullet } });
  useSelection.getState().selectRouteBullet('b1');
  useLiveViewportStore.setState({ pending: null });
  useSelection.setState({ ...useSelection.getState(), sidebarOpen: false });
});

afterEach(() => {
  useLiveViewportStore.setState({ pending: null });
  useSelection.getState().selectRouteBullet(null);
});

describe('item popovers dock to the top-right corner', () => {
  it('pins to the host corner regardless of where the item sits', () => {
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(leftTop().left).toBeCloseTo(800 - 320 - 8, 9);
    expect(leftTop().top).toBeCloseTo(8, 9);

    // An item way off in the corner of the world lands in the same dock.
    act(() => useDoc.getState().moveRouteBullet('b1', 5000, 4000));
    expect(leftTop().left).toBeCloseTo(800 - 320 - 8, 9);
    expect(leftTop().top).toBeCloseTo(8, 9);
  });

  it("right-aligns on the panel's measured width", () => {
    const restore = stubWidth(248);
    try {
      render(<ItemPopovers hostSize={committedView.size} />);
      expect(leftTop().left).toBeCloseTo(800 - 248 - 8, 9);
    } finally {
      restore();
    }
  });

  it('moves left of the open sidebar', () => {
    act(() => useSelection.setState({ ...useSelection.getState(), sidebarOpen: true }));
    render(<ItemPopovers hostSize={committedView.size} />);
    // The sidebar overlays the host's right 320px strip: the dock is the corner
    // of what is left of the host.
    expect(leftTop().left).toBeCloseTo(800 - 320 - 320 - 8, 9);
    expect(leftTop().top).toBeCloseTo(8, 9);
  });

  it('does not move with the canvas under a pan', () => {
    render(<ItemPopovers hostSize={committedView.size} />);
    const before = leftTop();
    act(() => useLiveViewportStore.setState({ pending: { x: -50, y: -30, zoom: 2 } }));
    expect(leftTop()).toEqual(before);
  });

  // A host wider than the window: the host's own corner — and the dock with it
  // — sits off the right of the screen until the page is scrolled there. The
  // panel is anchored to the WINDOW, so the browser holds it against that edge
  // and a scroll doesn't disturb it at all.
  it('holds one window position across a scroll, with no per-frame correction', () => {
    const page = stubPage(1024);
    try {
      render(<ItemPopovers hostSize={{ w: 1200, h: 600 }} />);
      const shell = document.querySelector(SEL) as HTMLElement;
      // Fixed, not absolute: this is what makes the numbers below stand still
      // — an absolute panel would scroll away and need chasing back.
      expect(shell.style.position).toBe('fixed');
      // Window coordinates: right edge one pad in, top one pad below the host's
      // own top (the toolbar's row is above it).
      const at = leftTop();
      expect(at).toEqual({ left: 1024 - 320 - 8, top: HOST_TOP + 8 });

      // The host slides 100px left under the window; the panel does not move.
      page.scrollTo(100);
      expect(leftTop()).toEqual(at);
      // Nor at the end of the travel, where the host's corner reaches the
      // window's edge and the two docks coincide.
      page.scrollTo(176);
      expect(leftTop()).toEqual(at);
    } finally {
      page.restore();
    }
  });

  it('yields to the sidebar strip as that scrolls into the window', () => {
    act(() => useSelection.setState({ ...useSelection.getState(), sidebarOpen: true }));
    const page = stubPage(700);
    try {
      render(<ItemPopovers hostSize={{ w: 1200, h: 600 }} />);
      // The sidebar owns host x ∈ [880, 1200] — entirely off screen here, so
      // the window's edge is the only thing to clear.
      expect(leftTop().left).toBeCloseTo(700 - 320 - 8, 9);
      // Its left edge reaches the window's at scrollX 180 — still nothing to
      // clear, so the panel hasn't budged.
      page.scrollTo(180);
      expect(leftTop().left).toBeCloseTo(700 - 320 - 8, 9);
      // Past that the strip is inside the window and the panel gives way,
      // sitting one pad left of it.
      page.scrollTo(300);
      expect(leftTop().left).toBeCloseTo(1200 - 300 - 320 - 320 - 8, 9);
    } finally {
      page.restore();
    }
  });

  it("floors at the window's left edge, not the host's", () => {
    const page = stubPage(200);
    try {
      render(<ItemPopovers hostSize={{ w: 1200, h: 600 }} />);
      page.scrollTo(500);
      // Right-aligning the 320px panel in a 200px window would put its left
      // edge at -128, off the side of the screen; the host's own left edge is
      // no better at -500. A panel too wide for the window pins to the window.
      expect(leftTop().left).toBeCloseTo(8, 9);
    } finally {
      page.restore();
    }
  });

  it('has an inert header — the panel is not draggable', () => {
    render(<ItemPopovers hostSize={committedView.size} />);
    const header = document.querySelector(`${SEL} .header`) as HTMLElement;
    if (!header.setPointerCapture) {
      (header as unknown as Record<string, unknown>).setPointerCapture = () => {};
      (header as unknown as Record<string, unknown>).releasePointerCapture = () => {};
    }
    const before = leftTop();
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 160, clientY: 140 });
    fireEvent.pointerUp(header, { clientX: 160, clientY: 140 });
    expect(leftTop()).toEqual(before);
  });
});
