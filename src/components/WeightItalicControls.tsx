import { ChevronDownIcon, FontItalicIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import * as Toggle from '@radix-ui/react-toggle';
import { FieldSelectContent } from './FieldSelectContent';
import { LABEL_WEIGHT_NAMES, isLabelWeight } from '../model/transforms';
import type { TextLabelWeight } from '../model/types';

/**
 * The Helvetica-Neue weight dropdown shared by every label/station style
 * surface — the text-label + station popovers and their Styles-panel editors.
 * A Radix Select so the list renders in-app: each option previews its own
 * weight and the current italic (native `<option>` styling is OS-dependent),
 * and the closed trigger reads in the face it selects. The row wrapper +
 * `<label>` stay in the caller: they differ across sites (`row` vs
 * `field-row`, with/without an htmlFor, and whether italic sits in this row
 * or over with align buttons).
 *
 * The open panel portals to `.app` (via FieldSelectContent) so it escapes the
 * canvas-host stacking trap — otherwise a weight list that flips up hides under
 * the toolbar — while staying inside `.app` for the tokens + dark mode.
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
  const face = (weight: number) => ({
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontWeight: weight,
    fontStyle: italic ? ('italic' as const) : ('normal' as const),
  });
  return (
    <Select.Root
      value={String(value)}
      disabled={disabled}
      onValueChange={(v) => {
        const n = Number(v);
        if (isLabelWeight(n)) onChange(n);
      }}
    >
      <Select.Trigger id={id} className="field-select" aria-label="Weight" style={face(value)}>
        <Select.Value />
        <Select.Icon className="field-select-caret" aria-hidden="true">
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>
      <FieldSelectContent>
        {LABEL_WEIGHT_NAMES.map((w) => (
          <Select.Item
            key={w.value}
            value={String(w.value)}
            className="field-select-item"
            style={face(w.value)}
          >
            <Select.ItemText>{w.name}</Select.ItemText>
          </Select.Item>
        ))}
      </FieldSelectContent>
    </Select.Root>
  );
}

/** The italic toggle button shared by the same surfaces (a Radix Toggle:
 *  same button + aria-pressed contract, Enter/Space handled uniformly). */
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
    <Toggle.Root
      className={'italic-btn' + (active ? ' active' : '')}
      pressed={active}
      disabled={disabled}
      onPressedChange={onToggle}
      title="Italic"
      aria-label="Italic"
    >
      <FontItalicIcon />
    </Toggle.Root>
  );
}
