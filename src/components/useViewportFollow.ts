import { useEffect, useRef } from 'react';

/**
 * Re-run `onChange` whenever the window moves under a piece of screen-space
 * chrome — the repo's canonical page-scroll hook, shared by everything that
 * measures a box in window coordinates and has to keep it there (`useDock`,
 * `usePopover`'s anchored panels, `ColorField`'s picker).
 *
 * The listener trio is the whole content, and each third is load-bearing:
 *
 *  - A **page** scroll is dispatched at `document` and bubbles to `window`
 *    (uniquely — element scrolls don't bubble at all), so the BUBBLE listener
 *    on `window` is the one that reliably hears it. A capture listener on
 *    `window` does not: instrumenting one in Chrome counted zero events across
 *    a scroll that demonstrably moved the page, which is what once left a panel
 *    sitting under the sidebar at the end of the travel.
 *  - The CAPTURE listener on `document` is what catches a scroll of some nested
 *    container instead, since those never bubble. A page scroll trips both;
 *    consumers are expected to bail out on a value-equal measurement, which
 *    makes the second a no-op.
 *  - `resize` covers the window changing size without scrolling at all.
 *
 * Passive throughout, so following never holds up the scroll itself.
 *
 * `onChange` is read through a ref, so a caller may hand in a fresh closure
 * every render without re-registering: the listeners attach and detach on
 * `active` alone. Pass `active: false` (a closed panel) to hold none of them —
 * the callback is otherwise one measurement and one render per scroll tick.
 *
 * Beware verifying this by hand in a page that is producing no frames: it
 * dispatches no scroll events to ANY listener (popoverDock.spec records that
 * trap), which reads as stranded chrome whatever the listeners say.
 * toolbarOverflow e2e holds the real contract, scrolling the page under an open
 * panel and asserting the edge stays flush.
 */
export function useViewportFollow(active: boolean, onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (!active) return;
    const run = () => latest.current();
    window.addEventListener('scroll', run, { passive: true });
    document.addEventListener('scroll', run, { passive: true, capture: true });
    window.addEventListener('resize', run);
    return () => {
      window.removeEventListener('scroll', run);
      document.removeEventListener('scroll', run, { capture: true });
      window.removeEventListener('resize', run);
    };
  }, [active]);
}
