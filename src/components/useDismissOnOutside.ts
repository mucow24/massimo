import { useEffect, useRef } from 'react';

/**
 * The "this transient thing stands down when you look away" rule, shared by
 * every non-Radix affordance that owns the window while it is up: a pointerdown
 * outside it, or Escape, dismisses it without running anything.
 *
 * Both listeners are on `window` in the CAPTURE phase, which is what makes the
 * rule work at all — a pointerdown inside some other popover would otherwise be
 * acted on before this ever heard about it. The press itself is NOT consumed:
 * clicking straight from an open picker onto a button should do both things.
 * Escape IS consumed (`stopPropagation`), because standing the affordance down
 * is that keypress's whole meaning — an enclosing dialog must not also read it
 * as "close me".
 *
 * `isInside` decides what counts as the affordance: a DOM containment test for
 * a popover with refs, a selector match for a button that marks itself. It and
 * `dismiss` are read through a ref, so a caller may pass fresh closures every
 * render without the listeners detaching and re-attaching; only `active` does
 * that.
 */
export function useDismissOnOutside(
  active: boolean,
  isInside: (target: EventTarget | null) => boolean,
  dismiss: () => void,
): void {
  const latest = useRef({ isInside, dismiss });
  // Declared BEFORE the attach effect so it has already run by the time the
  // listeners exist, on the commit that first turns `active` on.
  useEffect(() => {
    latest.current = { isInside, dismiss };
  });

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (!latest.current.isInside(e.target)) latest.current.dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      latest.current.dismiss();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active]);
}
