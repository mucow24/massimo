import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { windowClientSize } from '../../util/windowSize';

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

export interface DockInto {
  /** Width of the strip the open sidebar overlays at the host's right edge; 0
   *  while it's hidden or has ceded the corner. */
  strip: number;
  /** React's copy of the host width, already minus `strip` — the stand-in for
   *  when there is no laid-out host box to measure. */
  fallbackW: number;
}

function readDock(el: HTMLElement | null, into: DockInto): Dock {
  // The caller's element is a direct child of `.canvas-host`, so its parent IS
  // the host. (`offsetParent`, the usual way to name the box an offset is
  // measured from, is null for the fixed-position boxes this feeds.) Before it
  // mounts there's nothing to read; the layout effect below re-measures on
  // every commit, so the first real one lands before the browser paints.
  const host = el?.parentElement?.getBoundingClientRect();
  // The window's own edge, scrollbars excluded (see `windowClientSize`).
  const windowW = windowClientSize().w;
  // The host's LIVE right edge, not `fallbackW`. The two agree whenever React's
  // copy of the host width is current — but a viewport resize can leave that
  // copy a commit behind, and then the dock clears where the sidebar USED to
  // be: measured, a panel a second after the window narrowed still docked to
  // the pre-resize edge and sat under the sidebar. A rect is never stale. The
  // copy only stands in where there's no laid-out box to read at all — jsdom,
  // and the frame before the host is first measured.
  const dockable =
    host && host.width > 0 ? host.right - into.strip : (host?.left ?? 0) + into.fallbackW;
  // Both derived values are folded in HERE rather than left to the caller, so
  // that they STOP CHANGING once the window's edge is the nearer one: the
  // bailout below then swallows every scroll event in that regime and nothing
  // re-renders or repositions. `position: fixed` is what holds the box there.
  const right = Math.min(dockable, windowW);
  return { right, top: host?.top ?? 0, insetRight: windowW - right };
}

/**
 * Track the canvas host's docking corner in window coordinates — the shared
 * measurement behind every piece of chrome pinned to a corner of the canvas
 * (the item popovers via `usePinnedPopover`, the routing-warning toasts).
 *
 * `ref` is any element rendered directly into `.canvas-host`; `into` describes
 * the box to dock into — the host MINUS the open sidebar's strip, since the
 * sidebar overlays (and paints above) the host's right edge.
 *
 * Why this exists at all: the app grid is floored at the toolbar's natural
 * width (`.toolbar { min-width: max-content }`), so a narrower window leaves
 * the host wider than itself and the page scrolls sideways, carrying the
 * host's corners out of the window. Chrome that positions itself against a
 * corner has to dock to the nearer of the host's edge and the window's — and
 * be `position: fixed`, so the browser holds it against the window instead of
 * a scroll listener dragging it back a frame late.
 */
export function useDock(ref: React.MutableRefObject<HTMLElement | null>, into: DockInto): Dock {
  const [dock, setDock] = useState<Dock>(() => readDock(null, into));
  const measureRef = useRef<() => void>(() => {});
  // What the last measurement was taken FOR — see the guard below.
  const measuredFor = useRef<{ el: HTMLElement | null; strip: number; fallbackW: number } | null>(
    null,
  );

  // Dep-less, because one of the inputs isn't a dep at all: the element this
  // measures from may attach on a LATER commit than the mount (WarningToasts
  // renders null until the router flags a band, keeping this hook alive with a
  // null ref), and a keyed effect would never hear about it.
  //
  // But measuring on every commit is what made a narrow window crash. The
  // measurement moves with the page, and an ANIMATED page scroll gives a
  // different reading every frame — so through the stretch where the host's own
  // edge is the dock, a commit measured, set state, and committed again into a
  // page that had moved on. The value-equal bailout never fired and React tore
  // the app down at its nested-update limit. (The animation was the sidebar
  // revealing a selected station's row with `scrollIntoView`, which dragged the
  // whole page sideways to reach a row off the side of the window; Sidebar.tsx
  // scrolls the list's own box now. Any animated page scroll does it, though,
  // which is why the guard belongs here and not only there.)
  //
  // So measure when an INPUT changed, never merely because a commit happened.
  // Tracking motion is the scroll listener's job below, where one event costs
  // exactly one render.
  useLayoutEffect(() => {
    const measure = () =>
      setDock((prev) => {
        const next = readDock(ref.current, into);
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
    const prev = measuredFor.current;
    if (
      prev &&
      prev.el === ref.current &&
      prev.strip === into.strip &&
      prev.fallbackW === into.fallbackW
    ) {
      return;
    }
    measuredFor.current = { el: ref.current, strip: into.strip, fallbackW: into.fallbackW };
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
