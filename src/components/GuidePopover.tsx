import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import type { AlignmentGuide } from '../model/types';

interface Props {
  guide: AlignmentGuide;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

/**
 * The alignment guide's tiny editor: its one coordinate (Y for a horizontal
 * guide, X for a vertical — a signed, unbounded world position, so a plain
 * numeric field rather than a slider row), plus the standard lock/delete
 * footer. Everything else about a guide is direct manipulation on the canvas
 * (drag to move, drag back into its well to delete, arrow keys nudge).
 */
export function GuidePopover({ guide, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const moveGuide = useDoc((s) => s.moveGuide);
  const setGuideLocked = useDoc((s) => s.setGuideLocked);
  const deleteGuide = useDoc((s) => s.deleteGuide);

  const horizontal = guide.orientation === 'horizontal';
  const locked = guide.locked ?? false;
  // useNumericField (not a bare input): its text mirror ignores an emptied
  // field mid-edit — Number('') === 0 would teleport the guide to the axis.
  const field = useNumericField(
    Math.round(guide.offset),
    (n) => moveGuide(guide.id, n),
    () => Math.round(useDoc.getState().guides[guide.id]?.offset ?? guide.offset),
  );

  return (
    <PopoverShell
      className="bullet-popover guide-popover"
      title={horizontal ? 'Horizontal guide' : 'Vertical guide'}
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <div className="row" ref={locked ? undefined : field.attachWheel}>
        <label htmlFor="guide-offset">{horizontal ? 'Y' : 'X'}</label>
        <input
          id="guide-offset"
          type="number"
          aria-label={horizontal ? 'Y' : 'X'}
          className="options-popover-spin"
          style={{ marginLeft: 'auto' }}
          value={field.text}
          disabled={locked}
          onFocus={field.onNumberFocus}
          onChange={field.onNumberChange}
          onBlur={field.onNumberBlur}
        />
      </div>
      <PopoverFooter
        noun="guide"
        locked={locked}
        onToggleLock={() => setGuideLocked(guide.id, !locked)}
        onDelete={() => {
          deleteGuide(guide.id);
          onClose();
        }}
      />
    </PopoverShell>
  );
}
