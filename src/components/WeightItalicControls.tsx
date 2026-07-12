import { FontItalicIcon } from '@radix-ui/react-icons';
import { LABEL_WEIGHT_NAMES, isLabelWeight } from '../model/transforms';
import type { TextLabelWeight } from '../model/types';

/**
 * The Helvetica-Neue weight dropdown shared by every label/station style
 * surface — the text-label + station popovers and their Styles-panel editors.
 * Each option previews its own weight and the current italic, so the list reads
 * in the face it selects. The row wrapper + `<label>` stay in the caller: they
 * differ across sites (`row` vs `field-row`, with/without an htmlFor, and
 * whether italic sits in this row or over with align buttons).
 */
export function WeightSelect({
  id,
  value,
  italic,
  disabled,
  onChange,
}: {
  id?: string;
  value: TextLabelWeight;
  italic: boolean;
  disabled?: boolean;
  onChange: (w: TextLabelWeight) => void;
}) {
  return (
    <select
      id={id}
      className="weight-select"
      aria-label="Weight"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (isLabelWeight(n)) onChange(n);
      }}
    >
      {LABEL_WEIGHT_NAMES.map((w) => (
        <option
          key={w.value}
          value={w.value}
          style={{
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontWeight: w.value,
            fontStyle: italic ? 'italic' : 'normal',
          }}
        >
          {w.name}
        </option>
      ))}
    </select>
  );
}

/** The italic toggle button shared by the same surfaces. */
export function ItalicButton({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={'italic-btn' + (active ? ' active' : '')}
      disabled={disabled}
      onClick={onToggle}
      title="Italic"
      aria-label="Italic"
      aria-pressed={active}
    >
      <FontItalicIcon />
    </button>
  );
}
