// Item popovers are pinned to the host's top-right corner — the same dock the
// line editor and the station layout editor use — instead of spawning beside
// the item and tracking the canvas. The pin is screen-space: it ignores the
// item, ignores pan/zoom, and only moves for the open sidebar (which overlays
// the host's right strip) and the host box itself.
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
