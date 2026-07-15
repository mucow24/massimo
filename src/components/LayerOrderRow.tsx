import { ArrowDownIcon, ArrowUpIcon, PinBottomIcon, PinTopIcon } from '@radix-ui/react-icons';

interface LayerOrderRowProps {
  /** Item kind, used in the buttons' aria-labels (e.g. "polygon", "image"). */
  noun: string;
  /** Send the item to the very top (front) of its z-order. */
  onMoveToTop: () => void;
  /** Bring the item one step forward (up) in z-order. */
  onMoveUp: () => void;
  /** Send the item one step back (down) in z-order. */
  onMoveDown: () => void;
  /** Send the item to the very bottom (back) of its z-order. */
  onMoveToBottom: () => void;
  /** Disabled while the item is locked. */
  disabled: boolean;
}

/**
 * The four z-order steps, ordered topmost action first so the row reads left→
 * right as one gradient. The `title`s keep the bring-forward/send-backward
 * vocabulary; the noun-bearing `aria-label` is the accessible name. Icons are
 * paired so the jumps (arrow into a bar) stay distinct from the single steps
 * (bare arrow) at button size.
 */
const MOVES = [
  { key: 'top', Icon: PinTopIcon, suffix: 'to top', title: 'Bring to front' },
  { key: 'up', Icon: ArrowUpIcon, suffix: 'up', title: 'Bring forward' },
  { key: 'down', Icon: ArrowDownIcon, suffix: 'down', title: 'Send backward' },
  { key: 'bottom', Icon: PinBottomIcon, suffix: 'to bottom', title: 'Send to back' },
] as const;

/**
 * The "Layer" z-order row shared by the layered-item popovers (polygon, svg
 * image). Like {@link PopoverFooter}, this factors out popover chrome that
 * would otherwise be copy-pasted per item type. The four buttons split the
 * same width the two used to (`.shape-btn` is `flex: 1` inside a `flex: 1`
 * group), landing at the toolbar's icon-button size.
 */
export function LayerOrderRow({
  noun,
  onMoveToTop,
  onMoveUp,
  onMoveDown,
  onMoveToBottom,
  disabled,
}: LayerOrderRowProps) {
  const handlers = {
    top: onMoveToTop,
    up: onMoveUp,
    down: onMoveDown,
    bottom: onMoveToBottom,
  };
  return (
    <div className="row">
      <label>Layer</label>
      <div className="shape-group">
        {MOVES.map(({ key, Icon, suffix, title }) => (
          <button
            key={key}
            type="button"
            className="shape-btn"
            aria-label={`Move ${noun} ${suffix}`}
            title={title}
            disabled={disabled}
            onClick={handlers[key]}
          >
            <Icon />
          </button>
        ))}
      </div>
    </div>
  );
}
