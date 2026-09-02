import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import App from '../../App';
import { WarningToasts } from './WarningToasts';
import { useDoc, useSelection } from '../../state/store';
import * as interlining from '../../geometry/interlining';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { DEFAULT_DOC } from '../../model/transforms';
import type { Line, Station } from '../../model/types';
import { makeLine } from '../../test/fixtures';
import { SIDEBAR_WIDTH } from '../sidebarLayout';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  // Sidebar open (its default) unless a test closes it; reset so the closed-
  // sidebar case can't leak its state into the next test.
  useSelection.setState({
    ...useSelection.getState(),
    sidebarOpen: true,
    uiMode: { kind: 'idle' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Same warning-producing geometry as MapCanvas.warning.test.tsx: two stations
// very close together with a large curve radius, so both bands route through
// corners too tight for a clean fillet and warn.
const seedWarningDoc = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 5, orientation: 'auto-vertical' },
  ];
  const label: Station['label'] = {
    row: 0,
    col: -1,
    rotation: 0,
    offset: 0,
    align: 'auto',
    valign: 'middle',
  };
  const s1: Station = { id: 's1', name: 'Alpha', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'Beta', x: 0, y: 20, rotation: 2, stops, label };
  const mkLine = (id: string, color: string): Line =>
    makeLine({
      id,
      service: id,
      name: `${id} line`,
      color,
      stations: ['s1', 's2'],
      curveRadius: 80,
    });
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: mkLine('L1', '#0039A6'), L2: mkLine('L2', '#EE352E') },
      lineOrder: ['L1', 'L2'],
    });
  });
};

describe('WarningToasts', () => {
  it('shows one toast per warning band, naming the band’s stations', () => {
    render(<App />);
    seedWarningDoc();

    const toasts = Array.from(document.querySelectorAll('.warning-toasts .toast'));
    expect(toasts).toHaveLength(2);
    for (const t of toasts) {
      expect(t.textContent).toContain('Alpha');
      expect(t.textContent).toContain('Beta');
    }
  });

  it('reuses the canvas’s memoized bands instead of re-running the router', () => {
    // buildBands is the standalone convenience wrapper around
    // buildBandGeometry + assignLinePriorities. MapCanvas builds its bands
    // through the two-level memo, so nothing in the render tree should call
    // the wrapper — a second router run per frame is pure waste (it's the
    // most expensive pure computation in the app, and it used to run twice
    // on every station-drag frame).
    const spy = vi.spyOn(interlining, 'buildBands');
    render(<App />);
    seedWarningDoc();

    expect(document.querySelectorAll('.warning-toasts .toast')).toHaveLength(2);
    expect(spy).not.toHaveBeenCalled();
  });

  // The toasts rest in the bottom-right corner — exactly where the open sidebar
  // paints over them (it overlays the right strip, z-index above the canvas).
  // So while the panel shows, shift them left of it so they stay on screen; the
  // offset is the same SIDEBAR_WIDTH inset ItemPopovers subtracts from the
  // popover dock.
  it('shifts the toasts left of the sidebar while the panel is open', () => {
    render(<App />);
    seedWarningDoc();

    const el = document.querySelector('.warning-toasts') as HTMLElement;
    expect(el.style.right).toBe(`${12 + SIDEBAR_WIDTH}px`);
  });

  it('leaves the toasts at their resting inset when the sidebar is closed', () => {
    render(<App />);
    seedWarningDoc();
    act(() => useSelection.setState({ ...useSelection.getState(), sidebarOpen: false }));

    const el = document.querySelector('.warning-toasts') as HTMLElement;
    expect(el.style.right).toBe('12px');
  });
});

// A window narrower than the app scrolls the page sideways (`.toolbar {
// min-width: max-content }` floors the grid), carrying the host's bottom-right
// corner — and the sidebar docked at it — off the screen. The stack is pinned
// to the WINDOW, so it stays in the corner the user can see and only gives way
// to the sidebar for the part of that strip actually in view.
describe('WarningToasts on a window narrower than the app', () => {
  const HOST = { w: 1189, h: 700 };
  const WINDOW_W = 700;
  // Only the fields the component reads; the router's real spec is far wider.
  const band = {
    bandKey: 'b1',
    fromId: 's1',
    toId: 's2',
    warning: true,
    centerline: [{ x: 0, y: 0 }],
  } as unknown as SegmentBandSpec;

  // jsdom has no layout: stub the window's width and the host's box within it
  // (scrolling right slides that box left, to a negative `left`).
  function stubPage(): { scrollTo: (x: number) => void; restore: () => void } {
    const docEl = document.documentElement;
    const origRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
    let x = 0;
    Object.defineProperty(docEl, 'clientWidth', { configurable: true, get: () => WINDOW_W });
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      // Full, self-consistent box: the dock reads the host's live RIGHT edge.
      value: () => ({
        left: -x,
        right: -x + HOST.w,
        width: HOST.w,
        top: 0,
        bottom: 0,
        height: 0,
      }),
    });
    return {
      scrollTo: (to: number) => {
        x = to;
        // At `document`, where the browser fires it when the PAGE scrolls.
        fireEvent.scroll(document);
      },
      restore: () => {
        delete (docEl as unknown as Record<string, unknown>).clientWidth;
        Object.defineProperty(Element.prototype, 'getBoundingClientRect', origRect);
      },
    };
  }

  const rightInset = () => (document.querySelector('.warning-toasts') as HTMLElement).style.right;

  it('hugs the window while the sidebar is scrolled out of view, then gives way to it', () => {
    const page = stubPage();
    try {
      render(<WarningToasts bands={[band]} hostSize={HOST} />);
      // The sidebar owns host x ∈ [869, 1189] — entirely right of a 700px
      // window, so there is nothing to clear and the stack sits at its resting
      // inset from the window's own corner.
      expect(rightInset()).toBe('12px');
      // Its left edge (host 869) reaches the window's right edge at scrollX
      // 169; still nothing in view to clear.
      page.scrollTo(169);
      expect(rightInset()).toBe('12px');
      // 100px further and 100px of strip is inside the window — the stack gives
      // way by exactly that much, no more.
      page.scrollTo(269);
      expect(rightInset()).toBe('112px');
      // At the end of the travel the whole strip is in view: the full shift.
      page.scrollTo(489);
      expect(rightInset()).toBe(`${12 + SIDEBAR_WIDTH}px`);
    } finally {
      page.restore();
    }
  });

  it('ignores the sidebar strip entirely when the panel is closed', () => {
    act(() => useSelection.setState({ ...useSelection.getState(), sidebarOpen: false }));
    const page = stubPage();
    try {
      render(<WarningToasts bands={[band]} hostSize={HOST} />);
      expect(rightInset()).toBe('12px');
      page.scrollTo(489);
      expect(rightInset()).toBe('12px');
    } finally {
      page.restore();
    }
  });
});
