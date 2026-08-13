import type { ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useNumericField } from './useNumericField';
import { clamp } from '../util/grid';

interface Props {
  /** Used as the slider thumb's `id` and the spinbutton's `aria-label`, so
   *  `getByRole('slider'|'spinbutton', { name })` works in tests. */
  id: string;
  label: string;
  /** Optional control rendered in the label column in place of the text label
   *  — e.g. the dot-shape picker on the Line inspector's combined dot row. The
   *  `label` prop still names the slider + spinbutton for a11y/tests. */
  leading?: ReactNode;
  /** Optional override marker (an `OverrideDot`) rendered first in the row —
   *  it positions itself in the `.style-fields` gutter. */
  dot?: ReactNode;
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
  /** Marks a neutral value with a tick on the slider track — e.g. leading 1 /
   *  tracking 0. Purely visual; the value grid still comes from `step`. */
  detent?: number;
  /** Greys out + disables both the slider and the spinbutton. */
  disabled?: boolean;
}

/**
 * A single Options-popover row: visible label, slider, and a numeric
 * spinbutton mirror. The slider is a Radix Slider (keyboard steps, Home/End,
 * proper aria value reporting); its thumb carries the same `useFieldHistory`
 * focus/blur pair the native range did, so a whole drag or arrow-key run
 * still collapses to one undo entry, shared with any typing in the same
 * focus arc.
 *
 * The spinbutton keeps a local text mirror so mid-edit empty / non-numeric
 * values don't write garbage to the store; on blur the text re-syncs to the
 * (clamped) store value. Wheel-scroll anywhere on the row increments by `step`
 * — handled once at the row level so the slider and the spinbutton both
 * respond without double-counting — and the mirror is shown to the step's
 * decimal places. A disabled row ignores the wheel.
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
  leading,
  dot,
}: Props) {
  const { text, history, onNumberFocus, onNumberChange, attachWheel, onNumberBlur } =
    useNumericField(value, onChange, getCurrent, step, min);

  // The store value may sit outside the slider's range (the spinbutton can
  // type past `max`); the slider clamps its own display, like the native
  // range did.
  const sliderValue = clamp(value, min, max);

  // attachWheel binds a non-passive native wheel listener (React's onWheel is
  // passive, so its preventDefault would warn + no-op). Omit it while disabled
  // so a disabled row ignores the wheel.
  return (
    <div className="options-popover-row" ref={disabled ? undefined : attachWheel}>
      {dot}
      {leading !== undefined ? (
        <div className="options-popover-label">{leading}</div>
      ) : (
        <label htmlFor={id} className="options-popover-label">
          {label}
        </label>
      )}
      <Slider.Root
        className="field-slider"
        min={min}
        max={max}
        step={step}
        value={[sliderValue]}
        disabled={disabled}
        onValueChange={([n]) => onChange(n)}
      >
        <Slider.Track className="field-slider-track">
          <Slider.Range className="field-slider-range" />
          {detent !== undefined && (
            <span
              className="field-slider-detent"
              aria-hidden="true"
              style={{ left: `${((detent - min) / (max - min)) * 100}%` }}
            />
          )}
        </Slider.Track>
        <Slider.Thumb id={id} className="field-slider-thumb" aria-label={label} {...history} />
      </Slider.Root>
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
