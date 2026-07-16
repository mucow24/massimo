import * as Slider from '@radix-ui/react-slider';
import { useFieldHistory } from '../useFieldHistory';

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
  // Slider [-100, 100] with detent at 0; textbox accepts any number.
  // Snap to 0 when the slider sits within ±2 of zero.
  const clampedSlider = Math.max(-100, Math.min(100, value));
  const sliderField = useFieldHistory();
  const numberField = useFieldHistory();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Slider.Root
        className={'field-slider field-slider-centered' + (indeterminate ? ' indeterminate' : '')}
        min={-100}
        max={100}
        step={1}
        // In indeterminate mode the thumb sits at 0 visually but the styling
        // makes it clear the value is "mixed" — see styles.css.
        value={[indeterminate ? 0 : clampedSlider]}
        onValueChange={([n]) => onChange(Math.abs(n) <= 2 ? 0 : n)}
      >
        <Slider.Track className="field-slider-track">
          <Slider.Range className="field-slider-range" />
          {/* The neutral tick at offset 0 (was the native datalist detent). */}
          <span className="field-slider-detent" aria-hidden="true" style={{ left: '50%' }} />
        </Slider.Track>
        <Slider.Thumb className="field-slider-thumb" aria-label="Offset" {...sliderField} />
      </Slider.Root>
      <input
        type="number"
        aria-label="Offset value"
        className="options-popover-spin"
        value={indeterminate ? '' : value}
        placeholder={indeterminate ? '—' : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return; // ignore empty mid-edit (Number('') === 0)
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 56 }}
        {...numberField}
      />
    </div>
  );
}
