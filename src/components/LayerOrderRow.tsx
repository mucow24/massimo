import { ArrowDownIcon, ArrowUpIcon } from '@radix-ui/react-icons';

interface LayerOrderRowProps {
  /** Item kind, used in the buttons' aria-labels (e.g. "polygon", "image"). */
  noun: string;
  /** Send the item one step back (down) in z-order. */
  onMoveDown: () => void;
  /** Bring the item one step forward (up) in z-order. */
  onMoveUp: () => void;
  /** Disabled while the item is locked. */
  disabled: boolean;
}

/**
 * The "Layer" send-backward / bring-forward z-order row shared by the layered-
 * item popovers (polygon, svg image). Like {@link PopoverFooter}, this factors
 * out popover chrome that would otherwise be copy-pasted per item type.
 */
export function LayerOrderRow({ noun, onMoveDown, onMoveUp, disabled }: LayerOrderRowProps) {
  return (
    <div className="row">
      <label>Layer</label>
      <div className="shape-group">
        <button
          type="button"
          className="shape-btn"
          aria-label={`Move ${noun} down`}
          title="Send backward"
          disabled={disabled}
          onClick={onMoveDown}
        >
          <ArrowDownIcon />
        </button>
        <button
          type="button"
          className="shape-btn"
          aria-label={`Move ${noun} up`}
          title="Bring forward"
          disabled={disabled}
          onClick={onMoveUp}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </div>
  );
}
