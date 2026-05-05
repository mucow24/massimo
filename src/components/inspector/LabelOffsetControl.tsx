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
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        // In indeterminate mode the slider thumb sits at 0 visually but the
        // styling makes it clear the value is "mixed" — see styles.css.
        value={indeterminate ? 0 : clampedSlider}
        className={indeterminate ? 'indeterminate' : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Math.abs(n) <= 2 ? 0 : n);
        }}
        style={{ flex: 1 }}
        {...sliderField}
      />
      <input
        type="number"
        value={indeterminate ? '' : value}
        placeholder={indeterminate ? '—' : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 56 }}
        {...numberField}
      />
    </div>
  );
}
