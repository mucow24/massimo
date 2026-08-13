import { useState } from 'react';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import { guideAlongOf, guideFoot } from '../geometry/snap';
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
 * numeric field rather than a slider row) and its Length — 2 × the extent's
 * half-length, reading "∞" (an empty box under that placeholder) while the
 * guide is infinite — plus the standard lock/delete footer. Everything else
 * about a guide is direct manipulation on the canvas (drag to move, Ctrl-drag
 * to bound, drag back into its well to delete, arrow keys nudge).
 */
export function GuidePopover({ guide, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const moveGuide = useDoc((s) => s.moveGuide);
  const resizeGuide = useDoc((s) => s.resizeGuide);
  const setGuideLocked = useDoc((s) => s.setGuideLocked);
  const deleteGuide = useDoc((s) => s.deleteGuide);

  const coord = COORD[guide.orientation];
  const locked = guide.locked ?? false;
  const extent = guide.extent;
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
  // The Length mirror, live only while bounded: commits keep the current
  // center, and a zero-or-negative length is refused by resizeGuide rather
  // than collapsing the span (the blur re-sync then snaps the text back).
  const lengthField = useNumericField(
    extent ? cleanFloat(2 * extent.halfLength) : 0,
    (n) => {
      const cur = useDoc.getState().guides[guide.id]?.extent;
      if (cur) resizeGuide(guide.id, { center: cur.center, halfLength: n / 2 });
    },
    () => {
      const cur = useDoc.getState().guides[guide.id]?.extent;
      return cur ? cleanFloat(2 * cur.halfLength) : 0;
    },
  );
  // Typing a length into an INFINITE guide: there is no center to keep and no
  // numeric mirror to speak ∞, so the box holds plain local text and commits
  // on blur — the span lands centered on the visible viewport center's foot
  // on the guide (the viewport is centered on the store's (x, y)).
  const [pendingLength, setPendingLength] = useState('');
  const bindFromViewport = (raw: string) => {
    setPendingLength('');
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n <= 0) return;
    const v = useViewportStore.getState();
    const center = guideAlongOf(
      guide.orientation,
      guideFoot(guide.orientation, guide.offset, { x: v.x, y: v.y }),
    );
    resizeGuide(guide.id, { center, halfLength: n / 2 });
  };

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
      <div className="row" ref={locked || !extent ? undefined : lengthField.attachWheel}>
        <label
          htmlFor="guide-length"
          title="Along-axis length of the bounded span — ∞ runs the whole canvas"
        >
          Length
        </label>
        <button
          type="button"
          className="ghost-btn"
          aria-label="Make infinite"
          title="Remove the bounds — the guide runs the whole canvas again"
          style={{ marginLeft: 'auto' }}
          disabled={locked || !extent}
          onClick={() => resizeGuide(guide.id, null)}
        >
          ∞
        </button>
        <input
          id="guide-length"
          type="number"
          aria-label="Length"
          className="options-popover-spin"
          value={extent ? lengthField.text : pendingLength}
          placeholder={extent ? undefined : '∞'}
          disabled={locked}
          onFocus={extent ? lengthField.onNumberFocus : undefined}
          onChange={extent ? lengthField.onNumberChange : (e) => setPendingLength(e.target.value)}
          onBlur={extent ? lengthField.onNumberBlur : (e) => bindFromViewport(e.target.value)}
          onKeyDown={extent ? undefined : (e) => e.key === 'Enter' && e.currentTarget.blur()}
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
