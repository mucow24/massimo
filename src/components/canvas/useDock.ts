import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Where the canvas host's docking corner sits, in WINDOW coordinates. */
export interface Dock {
  /** The right edge a docked panel aligns to. */
  right: number;
  /** The host's own top edge. */
  top: number;
  /** How far `right` sits inside the window's own right edge — what a
   *  right-anchored box (CSS `right`) has to add to its resting inset. */
  insetRight: number;
}

function readDock(el: HTMLElement | null, hostW: number): Dock {
  // The caller's element is a direct child of `.canvas-host`, so its parent IS
  // the host. (`offsetParent`, the usual way to name the box an offset is
  // measured from, is null for the fixed-position boxes this feeds.) Before it
  // mounts there's nothing to read; the layout effect below re-measures on
  // every commit, so the first real one lands before the browser paints.
  const host = el?.parentElement?.getBoundingClientRect();
  // clientWidth, not innerWidth: it excludes the vertical scrollbar, and the
  // narrow window that scrolls the app horizontally has one — `.app` is 100vh,
  // which doesn't count the horizontal scrollbar, so the page also overflows
  // vertically by its height. jsdom has no layout and reports 0 for every
  // clientWidth; the innerWidth it does report stands in there.
  const windowW = document.documentElement.clientWidth || window.innerWidth;
  // Both derived values are folded in HERE rather than left to the caller, so
  // that they STOP CHANGING once the window's edge is the nearer one: the
  // bailout below then swallows every scroll event in that regime and nothing
  // re-renders or repositions. `position: fixed` is what holds the box there.
  const right = Math.min((host?.left ?? 0) + hostW, windowW);
  return { right, top: host?.top ?? 0, insetRight: windowW - right };
}

/**
 * Track the canvas host's docking corner in window coordinates — the shared
 * measurement behind every piece of chrome pinned to a corner of the canvas
 * (the item popovers via `usePinnedPopover`, the routing-warning toasts).
 *
 * `ref` is any element rendered directly into `.canvas-host`; `hostW` is the
 * width to dock into, which is the host MINUS the open sidebar's strip (the
 * sidebar overlays — and paints above — the host's right edge).
 *
 * Why this exists at all: the app grid is floored at the toolbar's natural
 * width (`.toolbar { min-width: max-content }`), so a narrower window leaves
 * the host wider than itself and the page scrolls sideways, carrying the
 * host's corners out of the window. Chrome that positions itself against a
 * corner has to dock to the nearer of the host's edge and the window's — and
 * be `position: fixed`, so the browser holds it against the window instead of
 * a scroll listener dragging it back a frame late.
 */
export function useDock(ref: React.MutableRefObject<HTMLElement | null>, hostW: number): Dock {
  const [dock, setDock] = useState<Dock>(() => readDock(null, hostW));
  const measureRef = useRef<() => void>(() => {});

  // Deliberately dep-less: the measurement must re-run on EVERY commit, not
  // just when `hostW` changes. The element it measures from may have only just
  // appeared (WarningToasts renders null until the router flags a band, keeping
  // this hook alive with a null ref), and a `hostW`-keyed effect would never
  // hear about it. The value-equal bailout is what stops the setState looping.
  useLayoutEffect(() => {
    const measure = () =>
      setDock((prev) => {
        const next = readDock(ref.current, hostW);
        // insetRight too, not just right: a resize while the HOST's edge is the
        // dock moves the window's edge without moving `right`, and a
        // right-anchored consumer reads only the inset.
        return prev.right === next.right &&
          prev.top === next.top &&
          prev.insetRight === next.insetRight
          ? prev
          : next;
      });
    measureRef.current = measure;
    measure();
  });

  // Registered once, and only the host-edge regime needs them: while the
  // window's edge is the dock, `readDock` returns the same value every time
  // and the bailout above swallows the event.
  //
  // A page scroll is dispatched at `document`, and the listener that reliably
  // sees it is the BUBBLE-phase one on `window` — the canonical page-scroll
  // hook. A capture-phase listener on `window` does NOT: instrumenting one in
  // Chrome counted zero events across a scroll that demonstrably moved the
  // page, which is what left a panel sitting under the sidebar at the end of
  // the travel. The capture listener on `document` is the one that catches a
  // scroll of some nested container instead, since those don't bubble at all;
  // a page scroll trips both, and the bailout makes the second a no-op.
  // Passive throughout, so tracking never holds up the scroll itself.
  useEffect(() => {
    const onScroll = () => measureRef.current();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return dock;
}
