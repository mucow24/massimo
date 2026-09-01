import { useState } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { useThemeColors } from '../state/theme';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import { FieldSelectContent } from './FieldSelectContent';
import { guideAlongOf, guideFoot, roundMeasurement } from '../geometry/snap';
import { GUIDE_COLORS, type GuideColor } from '../model/types';
import type { AlignmentGuide, GuideOrientation } from '../model/types';

// Half a world unit per wheel tick, arrow press and spinner click — the
// granularity a guide is nudged at, not a claim about what the fields hold
// (a typed 120.37 still lands). Its one decimal place is also what pads the
// text mirrors, so a whole coordinate reads "120.0" and the box does not
// change width as a drag crosses a unit boundary.
//
// The wheel additionally LANDS on the half grid from an off-grid value
// (stepFromValue). The arrows and the spinner only match that where the input
// carries a `min`, which doubles as the HTML step base — without one the base
// is the box's own value, since React writes it to the content attribute. So
// Length, floored at 0, agrees with its wheel; the offset row is signed and
// unbounded, and its arrows step half a unit from wherever the box sits.
const STEP = 0.5;

// The dropdown's display names — the stored values capitalized, spelled out so
// the rows and the union can't drift silently on a rename.
const COLOR_LABEL: Record<GuideColor, string> = {
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  purple: 'Purple',
  black: 'Black',
};

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
 * guide is infinite — plus the color-preset dropdown (paint AND spacing
 * family; see AlignmentGuide.color) and the standard lock/delete footer.
 * Everything else
 * about a guide is direct manipulation on the canvas (drag to move, Ctrl-drag
 * to bound, drag back into its well to delete, arrow keys nudge).
 */
export function GuidePopover({ guide, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const moveGuide = useDoc((s) => s.moveGuide);
  const resizeGuide = useDoc((s) => s.resizeGuide);
  const setGuideLocked = useDoc((s) => s.setGuideLocked);
  const setGuideColor = useDoc((s) => s.setGuideColor);
  const deleteGuide = useDoc((s) => s.deleteGuide);
  // For the dropdown's swatches — the same table the canvas paints from, so
  // the preview and the ink can't disagree (day/night included).
  const tints = useThemeColors().alignGuideTints;

  const coord = COORD[guide.orientation];
  const locked = guide.locked ?? false;
  const extent = guide.extent;
  // useNumericField (not a bare input): its text mirror ignores an emptied
  // field mid-edit — Number('') === 0 would teleport the guide to the axis.
  // `roundMeasurement`: a guide dragged out of its well sits wherever the
  // pointer said, and reciting all of 120.437291 back is noise — the box is a
  // reading, in the same one-decimal register as the chip that rides the guide
  // during a drag. The rounding covers `getCurrent` too, so a wheel tick steps
  // from the number on screen rather than from a stored value a tenth away —
  // otherwise the first tick can write a change the box can't show.
  const field = useNumericField(
    roundMeasurement(guide.offset),
    (n) => moveGuide(guide.id, n),
    () => roundMeasurement(useDoc.getState().guides[guide.id]?.offset ?? guide.offset),
    STEP,
  );
  // The Length mirror, live only while bounded: commits keep the current
  // center, and a zero-or-negative length is refused by resizeGuide rather
  // than collapsing the span (the blur re-sync then snaps the text back).
  const lengthField = useNumericField(
    extent ? roundMeasurement(2 * extent.halfLength) : 0,
    (n) => {
      const cur = useDoc.getState().guides[guide.id]?.extent;
      if (cur) resizeGuide(guide.id, { center: cur.center, halfLength: n / 2 });
    },
    () => {
      const cur = useDoc.getState().guides[guide.id]?.extent;
      return cur ? roundMeasurement(2 * cur.halfLength) : 0;
    },
    STEP,
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
          step={STEP}
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
          step={STEP}
          min={0}
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
      {/* The preset paint — and the guide's spacing family: the drag readout
          measures only between same-color parallels. Absent stores as blue,
          so the select speaks the default rather than an empty box. */}
      <div className="row">
        <label>Color</label>
        <Select.Root
          value={guide.color ?? 'blue'}
          disabled={locked}
          onValueChange={(v) => setGuideColor(guide.id, v as GuideColor)}
        >
          <Select.Trigger className="field-select" aria-label="Color">
            <Select.Value />
            <Select.Icon className="field-select-caret" aria-hidden="true">
              <ChevronDownIcon />
            </Select.Icon>
          </Select.Trigger>
          <FieldSelectContent>
            {GUIDE_COLORS.map((c) => (
              <Select.Item key={c} value={c} className="field-select-item">
                <Select.ItemText>
                  <span className="line-swatch" style={{ background: tints[c] }} aria-hidden />
                  {COLOR_LABEL[c]}
                </Select.ItemText>
              </Select.Item>
            ))}
          </FieldSelectContent>
        </Select.Root>
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
