import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import type { AlignmentGuide, GuideOrientation } from '../model/types';
import { cleanFloat } from '../util/grid';

// The one coordinate's title + field naming, per orientation. A diagonal's
// scalar is its Y-intercept — labeled Y₀, spelled out in the hover title.
const COORD: Record<GuideOrientation, { title: string; label: string; hint?: string }> = {
  horizontal: { title: 'Horizontal guide', label: 'Y' },
  vertical: { title: 'Vertical guide', label: 'X' },
  'diagonal-down': {
    title: 'Diagonal guide (\\)',
    label: 'Y₀',
    hint: 'Y where the guide crosses X = 0',
  },
  'diagonal-up': {
    title: 'Diagonal guide (/)',
    label: 'Y₀',
    hint: 'Y where the guide crosses X = 0',
  },
};

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

  const coord = COORD[guide.orientation];
  const locked = guide.locked ?? false;
  // useNumericField (not a bare input): its text mirror ignores an emptied
  // field mid-edit — Number('') === 0 would teleport the guide to the axis.
  // `cleanFloat`, not Math.round: a dragged guide must not read back as
  // "120.4000000001", but a guide that IS at 120.4 must say so — the box never
  // shows a coordinate the doc doesn't hold. The whole-unit step is what the
  // wheel and the arrow keys move by.
  const field = useNumericField(
    cleanFloat(guide.offset),
    (n) => moveGuide(guide.id, n),
    () => cleanFloat(useDoc.getState().guides[guide.id]?.offset ?? guide.offset),
  );

  return (
    <PopoverShell
      className="bullet-popover guide-popover"
      title={coord.title}
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <div className="row" ref={locked ? undefined : field.attachWheel}>
        <label htmlFor="guide-offset" title={coord.hint}>
          {coord.label}
        </label>
        <input
          id="guide-offset"
          type="number"
          aria-label={coord.label}
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
