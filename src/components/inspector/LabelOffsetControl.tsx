import { useFieldHistory } from '../useFieldHistory';

export function LabelOffsetControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
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
        value={clampedSlider}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Math.abs(n) <= 2 ? 0 : n);
        }}
        style={{ flex: 1 }}
        {...sliderField}
      />
      <input
        type="number"
        value={value}
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
