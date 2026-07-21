import type { CSSProperties, ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';

export interface SegmentedOption {
  /** The ToggleGroup value (a string). */
  value: string;
  /** Segment body — an icon, a text label, or a small preview. */
  content: ReactNode;
  /** Accessible name (tests query these). */
  label: string;
  /** Optional hover tooltip. Omit for text segments that already read as their label. */
  title?: string;
}

/**
 * A joined "select-one" segmented control (Radix ToggleGroup): the shared
 * button cluster used across the item popovers and the style editor. Shows the
 * CURRENT value highlighted; clicking a segment sets it. Re-clicking the active
 * segment is a no-op — the empty-string guard keeps it radio-like (you can't
 * deselect into an empty state).
 *
 * `itemClassName` is `align-btn` (text / small-icon rows) or `shape-btn` (the
 * larger shape/preview pickers); both are styled per parent (`.style-editor`,
 * `.bullet-popover`, `.text-label-popover`) in styles.css, so a caller must sit
 * inside one of those. `style` lets a row with two groups set `flex` so
 * unequal-length groups still divide the row evenly. Pass `disabled` (or wrap in
 * a disabled fieldset) to lock the whole group.
 */
export function SegmentedToggle({
  ariaLabel,
  value,
  options,
  onSelect,
  itemClassName = 'align-btn',
  disabled = false,
  style,
}: {
  ariaLabel?: string;
  value: string;
  options: SegmentedOption[];
  onSelect: (value: string) => void;
  itemClassName?: 'align-btn' | 'shape-btn';
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="align-group"
      style={style}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v) onSelect(v);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={itemClassName + (value === o.value ? ' active' : '')}
          aria-label={o.label}
          title={o.title}
        >
          {o.content}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
