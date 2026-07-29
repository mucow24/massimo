import { useLayoutEffect, useRef, useState } from 'react';
import { useSelection } from '../../state/store';
import { SIDEBAR_WIDTH, sidebarVisible } from '../Sidebar';
import { useDock } from './useDock';

export interface PinnedPopover {
  // WINDOW-pixel position for the popover's top-left; callers hand it to a
  // position:fixed shell (PopoverShell) as left/top directly.
  anchor: { x: number; y: number };
  // Attach to the shell's root: how the panel's own width reaches the pin.
  shellRef: React.MutableRefObject<HTMLDivElement | null>;
}

// Panel width assumed until the shell has been measured — the wider of the two
// real widths (.station-popover / .line-popover are 320, the item popovers
// 248), so an unmeasured panel errs toward the inside of the host.
const NOMINAL_W = 320;
const EDGE_PAD = 8;

/**
 * Dock a popover to the top-right corner of what is VISIBLE of `hostW` — one
 * home for the pin arithmetic, shared by every canvas panel: the item popovers
 * (station, route bullet, text label, polygon, svg image, transfer,
 * multi-selection), the line editor, and the station layout editor.
 *
 * `hostW` is the width the panel docks into, which is the canvas host MINUS
 * the open sidebar's strip (the sidebar overlays — and paints above — the
 * host's right edge, so docking to the raw host width would park the panel
 * under it). ItemPopovers owns that subtraction.
 *
 * When the window is narrower than the app, the host runs off the side of the
 * screen and its corner goes with it, so the dock is the nearer of the two
 * right edges — the window's while the host's is scrolled out of reach, the
 * host's (or the sidebar's) once that comes into view.
 *
 * The anchor is therefore in WINDOW coordinates (see `useDock`, the shared
 * measurement) and the shell is `position: fixed`: through the whole first
 * regime the number doesn't change, so the browser holds the panel against the
 * window edge and a scroll costs nothing — no re-render, no chasing, nothing to
 * trail. Only the second regime moves per scroll frame, and only because it
 * must: the sidebar and the host's corner are document-positioned, so a panel
 * giving way to them has to track them. That stretch is exactly `SIDEBAR_WIDTH`
 * of travel with the sidebar open, and nothing at all without it. An earlier
 * cut of this kept the shell absolute and re-placed it from a scroll listener
 * every frame; it visibly trailed the scroll, because the compositor scrolls
 * without waiting for the main thread.
 *
 * The panel right-aligns on its own measured width, read from the shell in a
 * layout effect so the corrected position is committed before the browser
 * paints. A hidden (display:none) shell measures 0, so the last real width
 * survives the excursion.
 */
export function usePinnedPopover(hostW: number): PinnedPopover {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [shellW, setShellW] = useState(NOMINAL_W);
  // The strip goes to the dock SEPARATELY from `hostW` (which already has it
  // subtracted): the dock prefers the host's live right edge, and has to know
  // what to take off it. Same `sidebarVisible` ItemPopovers reads to compute
  // `hostW`, so the two can't disagree.
  const strip = useSelection(sidebarVisible) ? SIDEBAR_WIDTH : 0;
  const dock = useDock(shellRef, { strip, fallbackW: hostW });
  // Deliberately dep-less: it must also catch the commit where a HIDDEN panel
  // is revealed (offsetWidth was 0 while display:none, and the panel keeps its
  // DOM node across the excursion). The `w !== shellW` guard is what stops the
  // setState from looping — the width converges on the first measured commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const w = shellRef.current?.offsetWidth ?? 0;
    if (w > 0 && w !== shellW) setShellW(w);
  });

  // The floor is the WINDOW's left edge: a panel too wide to fit pins there,
  // the host's own left edge being no better (it's off screen by however far
  // the page has scrolled).
  return {
    anchor: { x: Math.max(EDGE_PAD, dock.right - shellW - EDGE_PAD), y: dock.top + EDGE_PAD },
    shellRef,
  };
}
