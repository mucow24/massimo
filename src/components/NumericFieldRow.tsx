import { useNumericField } from './useNumericField';

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
  /** Spinbutton-only lower bound, when it differs from the slider's `min`
   *  (mirror of `textboxAllowAboveMax` for the floor — e.g. a 2..28 slider
   *  whose textbox/steppers accept down to 1). The transform's clamping
   *  decides the actual lower bound. */
  textboxMin?: number;
  /** Marks a neutral value with a tick on the slider track (native
   *  `<datalist>` hash mark) — e.g. leading 1 / tracking 0. Purely visual;
   *  the value grid still comes from `step`. */
  detent?: number;
  /** Greys out + disables both the slider and the spinbutton. */
  disabled?: boolean;
}

/**
 * A single Options-popover row: visible label, range slider, and a numeric
 * spinbutton mirror. Both inputs share one history group (slider drag and
 * any subsequent typing in the same focus arc collapse to one undo entry)
 * via a shared `useFieldHistory`.
 *
 * The spinbutton keeps a local text mirror so mid-edit empty / non-numeric
 * values don't write garbage to the store; on blur the text re-syncs to the
 * (clamped) store value. Wheel-scroll anywhere on the row increments by `step`
 * — handled once at the row level so the slider (which ignores wheel natively)
 * and the spinbutton both respond without double-counting — and the mirror is
 * shown to the step's decimal places. A disabled row ignores the wheel.
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
  textboxMin,
  detent,
  disabled,
}: Props) {
  const { text, history, onNumberFocus, onNumberChange, onNumberWheel, onNumberBlur } =
    useNumericField(value, onChange, getCurrent, step);

  return (
    <div className="options-popover-row" onWheel={disabled ? undefined : onNumberWheel}>
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
        list={detent !== undefined ? `${id}-detent` : undefined}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        {...history}
      />
      {detent !== undefined && (
        <datalist id={`${id}-detent`}>
          <option value={detent} />
        </datalist>
      )}
      <input
        type="number"
        aria-label={label}
        min={textboxMin ?? min}
        max={textboxAllowAboveMax ? undefined : max}
        step={step}
        className="options-popover-spin"
        value={text}
        disabled={disabled}
        onFocus={onNumberFocus}
        onChange={onNumberChange}
        onBlur={onNumberBlur}
      />
    </div>
  );
}
