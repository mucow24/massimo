import { useEffect, useRef, useState, type ChangeEvent, type WheelEvent } from 'react';
import { useFieldHistory } from './useFieldHistory';

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
 */
export function useNumericField(
  value: number,
  onChange: (n: number) => void,
  getCurrent: () => number,
) {
  const history = useFieldHistory();
  const [text, setText] = useState(String(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  return {
    text,
    history,
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
    onNumberWheel: (e: WheelEvent<HTMLInputElement>) => {
      e.preventDefault();
      onChange(getCurrent() + (e.deltaY < 0 ? 1 : -1));
    },
    onNumberBlur: () => {
      focusedRef.current = false;
      setText(String(getCurrent()));
      history.onBlur();
    },
  };
}
