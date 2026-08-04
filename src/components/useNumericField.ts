import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useFieldHistory } from './useFieldHistory';
import { withCoalescedHistory } from '../state/history';

/** Decimal places implied by a step: 1 → 0, 0.5 → 1, 0.25 → 2. Drives how many
 *  digits the text mirror shows so a half-step field reads "9.0" / "7.5". */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Integer-step fields keep their bare `String(n)` mirror (no rounding); a
 *  fractional step pads to its decimal places. */
function formatValue(n: number, decimals: number): string {
  return decimals > 0 ? n.toFixed(decimals) : String(n);
}

/**
 * Shared logic for a numeric spinbutton bound to a store value: a local text
 * mirror (so mid-edit empty / non-numeric input doesn't write garbage), a focus
 * guard (so external store updates don't clobber an in-progress edit),
 * wheel-to-increment, and a useFieldHistory group covering the whole focus arc.
 *
 * Returns the text mirror, the history object (spread onto a paired slider, or
 * wire its onFocus/onBlur however the markup needs), and the number-input
 * handlers. `getCurrent` returns the authoritative latest value for wheel
 * increments — usually `() => useStore.getState().field` — so a wheel tick that
 * fires before React re-renders an external change still steps from the live
 * value, not a stale prop.
 *
 * `step` is the field's granularity: each wheel tick moves by it, and the text
 * mirror is padded to its decimal places (1 → "9", 0.5 → "9.0"). It should match
 * the paired slider/spinbutton `step` attribute.
 */
export function useNumericField(
  value: number,
  onChange: (n: number) => void,
  getCurrent: () => number,
  step = 1,
) {
  const decimals = stepDecimals(step);
  const history = useFieldHistory();
  const [text, setText] = useState(formatValue(value, decimals));
  const focusedRef = useRef(false);
  // Stable identity for this field's wheel-burst coalescing (see onWheel).
  const burstKey = useRef({}).current;
  useEffect(() => {
    if (!focusedRef.current) setText(formatValue(value, decimals));
  }, [value, decimals]);

  // Wheel-to-increment must be a NON-passive native listener: React's onWheel
  // prop registers a passive root listener, so preventDefault() there warns
  // ("Unable to preventDefault inside passive event listener invocation") and
  // no-ops — the value ticks but the popover/page scrolls too. A ref keeps the
  // native listener calling the latest closure (fresh step/getCurrent) without
  // rebinding. Same pattern as the canvas wheel-zoom in useViewport.
  const onWheel = (e: WheelEvent) => {
    // Only a mostly-VERTICAL wheel is a step on this field. A horizontal swipe
    // (two fingers sideways, or Shift+wheel) carries deltaY 0 — or, on a
    // diagonal flick, a deltaY dwarfed by deltaX — and reading "not scrolling
    // up" as "scrolling down" walked the value steadily down on a gesture meant
    // to scroll. Before preventDefault, so the horizontal scroll still reaches
    // the page: the toolbar's min-width floors the app wider than a narrow
    // window, and that scroll is the only way to reach the far end.
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX || 0)) return;
    e.preventDefault();
    // One undo entry per SCROLL, not per tick: a trackpad flick over this field
    // fires dozens of these, and unfocused they land outside any field-history
    // group. burstKey is this field's identity, so a scroll that moves on to a
    // different field starts a new entry there.
    withCoalescedHistory(burstKey, () => {
      onChange(getCurrent() + (e.deltaY < 0 ? step : -step));
    });
    // A wheel tick is a deliberate adjustment of THIS field, so mirror the new
    // (clamped) value straight into the text — bypassing the focus guard, which
    // only exists to protect in-progress TYPING from foreign updates. Without
    // this the value ticks but the textbox stays frozen until blur while focused.
    setText(formatValue(getCurrent(), decimals));
  };
  const onWheelRef = useRef(onWheel);
  useEffect(() => {
    onWheelRef.current = onWheel;
  });
  // A stable callback ref: binds { passive: false } on attach, detaches when
  // React calls it with null (unmount / element swap / a row toggling disabled).
  const detachRef = useRef<(() => void) | null>(null);
  const attachWheel = useCallback((el: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!el) return;
    const listener = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener('wheel', listener, { passive: false });
    detachRef.current = () => el.removeEventListener('wheel', listener);
  }, []);

  return {
    text,
    history,
    attachWheel,
    onNumberFocus: () => {
      focusedRef.current = true;
      history.onFocus();
    },
    onNumberChange: (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setText(raw);
      if (raw === '') return; // ignore empty mid-edit
      const n = Number(raw);
      if (Number.isFinite(n)) onChange(n);
    },
    onNumberBlur: () => {
      focusedRef.current = false;
      setText(formatValue(getCurrent(), decimals));
      history.onBlur();
    },
  };
}
