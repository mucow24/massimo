import * as Select from '@radix-ui/react-select';
import type { LineEndStyle } from '../model/types';
import { LINE_END_STYLES } from '../model/lineEnd';
import { FieldSelectContent } from './FieldSelectContent';
import { SegmentedToggle } from './SegmentedToggle';

export const LINE_END_LABELS: Record<LineEndStyle, string> = {
  square: 'Square',
  short: 'Short',
  round: 'Round',
};

// Why the per-stop control is greyed out on most rows: only a stop the line
// actually ENDS at has an end to dress.
const DISABLED_TITLE = 'End style disabled — only a stop at the end of the line can take one';

const LINE_END_TITLES: Record<LineEndStyle, string> = {
  square: 'Square — fully encloses final stop',
  short: 'Short — half-encloses final stop, so a same-width dot covers the end',
  round: 'Round — a rounded end, smooth behind a narrower round dot',
};

// The three ends ARE SVG's three line caps taken at the stop center, so the
// glyph is just that: one stroke, three caps. Drawn thick and short so the cap
// is most of what you see — at 15px the shape of the end is the only thing
// that reads, which is exactly the choice being made.
const CAP_OF: Record<LineEndStyle, 'square' | 'butt' | 'round'> = {
  square: 'square',
  short: 'butt',
  round: 'round',
};

export function LineEndGlyph({ end }: { end: LineEndStyle }) {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <line
        x1={1.5}
        y1={7.5}
        x2={9}
        y2={7.5}
        stroke="currentColor"
        strokeWidth={9}
        strokeLinecap={CAP_OF[end]}
      />
    </svg>
  );
}

/**
 * The line-end control for the two line editors (the line inspector and the
 * line style editor): a three-segment icon group, one segment per end. Wide
 * enough there to show all three at once, so the choice needs no opening.
 */
export function LineEndSegmented({
  value,
  onSelect,
  ariaLabel = 'Line ends',
}: {
  value: LineEndStyle;
  onSelect: (end: LineEndStyle) => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedToggle
      ariaLabel={ariaLabel}
      value={value}
      onSelect={(v) => onSelect(v as LineEndStyle)}
      options={LINE_END_STYLES.map((end) => ({
        value: end,
        label: LINE_END_LABELS[end],
        title: LINE_END_TITLES[end],
        content: <LineEndGlyph end={end} />,
      }))}
    />
  );
}

/**
 * The same three ends as a compact dropdown, for the per-stop row in the
 * station editor — one square glyph slot alongside the type/transfer/size/
 * direction controls, where a three-segment group would not fit. Shows the
 * RESOLVED end (what the stop actually paints), so picking the line's own value
 * clears the pin rather than storing a redundant one — the contract the dot
 * size box already uses.
 *
 * Only a terminus can pin an end, but the control renders on every row and goes
 * DISABLED elsewhere rather than vanishing: an empty slot read as a rendering
 * fault, and the columns have to hold their positions down the list either way.
 */
export function LineEndSelect({
  value,
  onSelect,
  ariaLabel,
  disabled = false,
}: {
  value: LineEndStyle;
  onSelect: (end: LineEndStyle) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={(v) => onSelect(v as LineEndStyle)}>
      {/* The disabled explanation rides the WRAPPER, not the trigger: a
          disabled button gets no hover events, so a title on it would never
          surface — and a greyed control that can't say why is the same puzzle
          as the empty slot it replaced. The span hovers fine. */}
      <span className="end-style-slot" title={disabled ? DISABLED_TITLE : undefined}>
        <Select.Trigger
          className="field-select end-style-select"
          aria-label={ariaLabel}
          title={disabled ? undefined : LINE_END_TITLES[value]}
          disabled={disabled}
        >
          <LineEndGlyph end={value} />
        </Select.Trigger>
      </span>
      <FieldSelectContent>
        {LINE_END_STYLES.map((end) => (
          <Select.Item key={end} value={end} className="field-select-item">
            <span className="glyph-item">
              <LineEndGlyph end={end} />
              <Select.ItemText>{LINE_END_LABELS[end]}</Select.ItemText>
            </span>
          </Select.Item>
        ))}
      </FieldSelectContent>
    </Select.Root>
  );
}
