import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MutableRefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useDock, type DockInto } from './useDock';

// jsdom has no layout: every getBoundingClientRect is a zero box and
// documentElement.clientWidth is 0, which is exactly the "no laid-out box"
// regime the hook falls back for. So the host's rect is mocked per case and the
// window width comes from innerWidth, the stand-in the hook already documents.
const WINDOW_W = 1024;

type Rect = ReturnType<Element['getBoundingClientRect']>;

/** A host box, as `getBoundingClientRect` reports one. */
const rect = (left: number, right: number, top = 0): Rect =>
  ({ left, right, top, width: right - left, height: 100, bottom: top + 100 }) as Rect;

// The hook measures from its ref element's PARENT, which is the canvas host.
let host: HTMLElement;
let ref: MutableRefObject<HTMLElement | null>;
let originalInnerWidth: number;

/** Point the host's rect at `r` from here on — the page moving under the hook. */
const setHostRect = (r: Rect) => {
  host.getBoundingClientRect = () => r;
};

function mount(into: DockInto) {
  return renderHook(({ into: i }) => useDock(ref, i), { initialProps: { into } });
}

beforeEach(() => {
  originalInnerWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: WINDOW_W });
  host = document.createElement('div');
  document.body.appendChild(host);
  const el = document.createElement('div');
  host.appendChild(el);
  ref = { current: el };
  setHostRect(rect(0, 0));
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  host.remove();
});

describe('useDock', () => {
  it('docks to the host edge minus the open sidebar strip', () => {
    setHostRect(rect(0, 800, 50));
    const dock = mount({ strip: 120, fallbackW: 0 }).result.current;
    // The sidebar overlays (and paints above) the host's right edge, so the
    // dockable corner is inside it.
    expect(dock.right).toBe(680);
    expect(dock.top).toBe(50);
    // What a right-anchored `position: fixed` box has to add to its inset.
    expect(dock.insetRight).toBe(WINDOW_W - 680);
  });

  it('docks to the WINDOW edge when the host runs past it', () => {
    // The app grid is floored at the toolbar's natural width, so a narrow
    // window leaves the host wider than itself and the page scrolls sideways.
    // Chrome pinned to a corner has to take the nearer of the two edges.
    setHostRect(rect(0, 1500));
    const dock = mount({ strip: 0, fallbackW: 0 }).result.current;
    expect(dock.right).toBe(WINDOW_W);
    expect(dock.insetRight).toBe(0);
  });

  it('stands in with fallbackW only when there is no laid-out box to read', () => {
    setHostRect(rect(200, 200)); // width 0 — mounted but never measured
    expect(mount({ strip: 0, fallbackW: 300 }).result.current.right).toBe(500);
  });

  it('prefers the LIVE rect over a stale fallbackW', () => {
    // React's copy of the host width can lag a commit behind a viewport
    // resize; a rect never can. Measured, the lag docked a panel to the edge
    // the sidebar used to be at and left it sitting underneath.
    setHostRect(rect(0, 900));
    expect(mount({ strip: 100, fallbackW: 400 }).result.current.right).toBe(800);
  });

  it('does not re-measure on a commit whose inputs are unchanged', () => {
    // Measuring on EVERY commit is what made a narrow window crash: an
    // animated page scroll reads differently each frame, so a commit measured,
    // set state, and committed again into a page that had moved on — the
    // value-equal bailout never fired and React hit its nested-update limit.
    setHostRect(rect(0, 800));
    const { result, rerender } = mount({ strip: 0, fallbackW: 0 });
    expect(result.current.right).toBe(800);
    // The page moves under a commit that changed none of the hook's inputs.
    setHostRect(rect(0, 640));
    rerender({ into: { strip: 0, fallbackW: 0 } });
    expect(result.current.right).toBe(800);
  });

  it('re-measures when an input DOES change', () => {
    setHostRect(rect(0, 800));
    const { result, rerender } = mount({ strip: 0, fallbackW: 0 });
    // A fresh object with the same values is NOT a change — the guard compares
    // by value, so an inline `into` literal doesn't defeat it every render.
    rerender({ into: { strip: 0, fallbackW: 0 } });
    expect(result.current.right).toBe(800);
    // Opening the sidebar is.
    rerender({ into: { strip: 200, fallbackW: 0 } });
    expect(result.current.right).toBe(600);
  });

  it('tracks a page scroll, which is how the host-edge regime moves at all', () => {
    setHostRect(rect(0, 800));
    const { result } = mount({ strip: 0, fallbackW: 0 });
    setHostRect(rect(-160, 640));
    act(() => void window.dispatchEvent(new window.Event('scroll')));
    expect(result.current.right).toBe(640);
  });

  it('tracks a scroll of a nested container, which never bubbles', () => {
    // A page scroll is caught by the bubble-phase listener on `window`; a
    // scroll of some nested box only ever reaches the capture listener on
    // `document`. A page scroll trips both and the bailout makes the second a
    // no-op, so both listeners have to be there.
    setHostRect(rect(0, 800));
    const { result } = mount({ strip: 0, fallbackW: 0 });
    setHostRect(rect(0, 700));
    const nested = document.createElement('div');
    document.body.appendChild(nested);
    act(() => void nested.dispatchEvent(new window.Event('scroll', { bubbles: false })));
    expect(result.current.right).toBe(700);
    nested.remove();
  });

  it('updates insetRight when only the WINDOW edge moved', () => {
    // The bailout compares insetRight too, not just right: a resize while the
    // HOST's edge is the dock moves the window's edge without moving `right`,
    // and a right-anchored consumer reads only the inset. Comparing `right`
    // alone would swallow this and freeze the box at its old inset.
    setHostRect(rect(0, 700));
    const { result } = mount({ strip: 0, fallbackW: 0 });
    expect(result.current.insetRight).toBe(WINDOW_W - 700);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    act(() => void window.dispatchEvent(new window.Event('resize')));
    expect(result.current.right).toBe(700);
    expect(result.current.insetRight).toBe(200);
  });
});
