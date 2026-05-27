import { useEffect, useRef, useState } from 'react';
import { useFieldHistory } from './useFieldHistory';

interface Props {
  /** Used as the slider's `id` (for `<label htmlFor>` association) and the
   *  spinbutton's `aria-label`, so `getByRole('slider'|'spinbutton', { name })`
   *  works in tests. */
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  /** Returns the authoritative latest value for wheel-event increments.
   *  Usually `() => useDoc.getState().fieldName` — needed so a wheel event
   *  that fires before React has rendered an external store change still
   *  increments from the up-to-date value, not the stale prop. */
  getCurrent: () => number;
  /** When true, the spinbutton omits its `max` attribute so users can type
   *  values above the slider's range. The slider itself still tops out at
   *  `max`. The transform's clamping decides the actual upper bound. */
  textboxAllowAboveMax?: boolean;
}

/**
 * A single Options-popover row: visible label, range slider, and a numeric
 * spinbutton mirror. Both inputs share one history group (slider drag and
 * any subsequent typing in the same focus arc collapse to one undo entry)
 * via a shared `useFieldHistory`.
 *
 * The spinbutton keeps a local text mirror so mid-edit empty / non-numeric
 * values don't write garbage to the store; on blur the text re-syncs to the
 * (clamped) store value. Wheel-scroll over the spinbutton increments by 1.
 */
export function NumericFieldRow({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
  getCurrent,
  textboxAllowAboveMax,
}: Props) {
  const field = useFieldHistory();
  const [text, setText] = useState(String(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  return (
    <div className="options-popover-row">
      <label htmlFor={id} className="options-popover-label">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        {...field}
      />
      <input
        type="number"
        aria-label={label}
        min={min}
        max={textboxAllowAboveMax ? undefined : max}
        step={step}
        className="options-popover-spin"
        value={text}
        onFocus={() => {
          focusedRef.current = true;
          field.onFocus();
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw === '') return; // ignore empty mid-edit
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 1 : -1;
          onChange(getCurrent() + delta);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setText(String(getCurrent()));
          field.onBlur();
        }}
      />
    </div>
  );
}
