import { useLayoutEffect, useRef, useState } from 'react';

export interface PinnedPopover {
  // Screen-pixel position for the popover's top-left; callers use it as
  // left/top directly.
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
 * Dock a popover to the top-right corner of `hostW` — one home for the pin
 * arithmetic, shared by every canvas panel: the item popovers (station, route
 * bullet, text label, polygon, svg image, transfer, multi-selection), the line
 * editor, and the station layout editor.
 *
 * `hostW` is the width the panel docks into, which is the canvas host MINUS
 * the open sidebar's strip (the sidebar overlays — and paints above — the
 * host's right edge, so docking to the raw host width would park the panel
 * under it). ItemPopovers owns that subtraction.
 *
 * The panel right-aligns on its own measured width, read from the shell in a
 * layout effect so the corrected position is committed before the browser
 * paints. A hidden (display:none) shell measures 0, so the last real width
 * survives the excursion.
 */
export function usePinnedPopover(hostW: number): PinnedPopover {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [shellW, setShellW] = useState(NOMINAL_W);
  // Deliberately dep-less: it must also catch the commit where a HIDDEN panel
  // is revealed (offsetWidth was 0 while display:none, and the panel keeps its
  // DOM node across the excursion). The `w !== shellW` guard is what stops the
  // setState from looping — the width converges on the first measured commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const w = shellRef.current?.offsetWidth ?? 0;
    if (w > 0 && w !== shellW) setShellW(w);
  });

  return {
    anchor: { x: Math.max(EDGE_PAD, hostW - shellW - EDGE_PAD), y: EDGE_PAD },
    shellRef,
  };
}
