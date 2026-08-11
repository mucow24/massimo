import * as Slider from '@radix-ui/react-slider';
import { useFieldHistory } from '../useFieldHistory';
import { useNumericField } from '../useNumericField';
import { clamp } from '../../util/grid';

/** Granularity of both offset fields — slider grid, spinner arrows, and the
 *  text mirror's decimal places, which all have to agree. Half a unit: whole
 *  units were too coarse to seat a name against a stripe. */
const OFFSET_STEP = 0.5;

export function LabelOffsetControl({
  value,
  onChange,
  indeterminate = false,
}: {
  value: number;
  onChange: (v: number) => void;
  // When true, the matching set has multiple distinct offsets. The slider/
  // number show no specific value; the next interaction sets ALL of them.
  indeterminate?: boolean;
}) {
  // Slider [-100, 100] with a tick at 0; textbox accepts any number.
  const clampedSlider = clamp(value, -100, 100);
  const sliderField = useFieldHistory();
  // The textbox goes through the shared numeric field for its TEXT MIRROR, which
  // is what makes the negative half of the slider's range typeable. A lone "-"
  // is not a valid floating-point number, so a number input reports '' while
  // holding it in its raw buffer; bound straight to a number, React saw ''≠"0",
  // wrote "0" back, and "-5" came out as "05". The mirror stores the reported ''
  // and re-renders the same '', which React leaves alone — so the raw "-"
  // survives until the next digit makes it parse.
  const { text, onNumberFocus, onNumberChange, onNumberBlur } = useNumericField(
    value,
    onChange,
    () => value,
    OFFSET_STEP,
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Slider.Root
        className={'field-slider field-slider-centered' + (indeterminate ? ' indeterminate' : '')}
        min={-100}
        max={100}
        step={OFFSET_STEP}
        // In indeterminate mode the thumb sits at 0 visually but the styling
        // makes it clear the value is "mixed" — see styles.css.
        value={[indeterminate ? 0 : clampedSlider]}
        onValueChange={([n]) => onChange(n)}
      >
        <Slider.Track className="field-slider-track">
          <Slider.Range className="field-slider-range" />
          {/* The neutral tick at offset 0 — purely visual, like every other
              detent in the app (NumericFieldRow's `detent`). It used to also
              rewrite any value within ±2 to 0, which made 0 a trap: the first
              arrow press proposed a value inside the band, the rewrite sent it
              straight back to 0, and the controlled thumb never moved — so no
              offset smaller than the band was reachable by keyboard at all. */}
          <span className="field-slider-detent" aria-hidden="true" style={{ left: '50%' }} />
        </Slider.Track>
        <Slider.Thumb className="field-slider-thumb" aria-label="Offset" {...sliderField} />
      </Slider.Root>
      {/* No wheel ref: unlike the Options rows, these boxes have never taken a
          wheel tick, and the reading-direction offsets are not something to
          nudge past by scrolling over the inspector. */}
      <input
        type="number"
        aria-label="Offset value"
        className="options-popover-spin"
        // The stepper arrows walk the same half-unit grid as the slider. No
        // min/max: the box is the only way to reach past the slider's rails.
        step={OFFSET_STEP}
        value={indeterminate ? '' : text}
        placeholder={indeterminate ? '—' : undefined}
        onFocus={onNumberFocus}
        onChange={onNumberChange}
        onBlur={onNumberBlur}
      />
    </div>
  );
}
