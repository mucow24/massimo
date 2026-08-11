import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GuideOrientation } from '../../model/types';

/** Well strip thickness in screen px. Shared with useGuideDrag's release
 *  hit-test, so the strip you see IS the drop zone that cancels/deletes. */
export const WELL_SIZE_PX = 14;

interface Props {
  // Guides layer hidden (View menu): the wells stay visible but inert, with a
  // tooltip naming the fix — pulling out an invisible guide would read as the
  // gesture being broken (there is no placing mode to reveal the layer).
  guidesHidden: boolean;
  // A guide gesture is hovering this well: its drop would cancel the pull /
  // delete the dragged guide, so the strip tints as a drop target.
  armed: GuideOrientation | null;
  onWellPointerDown: (orientation: GuideOrientation, e: ReactPointerEvent) => void;
  // The sub-threshold stretch of a pull happens with the pointer still over
  // the strip (capture moves to the svg only on the first real move), so the
  // strips forward moves/ups into the same shared handlers the svg runs.
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
}

// The grip glyph: a short dashed bar in the pull direction, the guide's own
// dash pattern in miniature — the affordance previews the object it mints.
// Pure CSS (a repeating-gradient span), deliberately NOT an inline <svg>: the
// e2e suite locates the map canvas with the loose `.canvas-host svg`, and a
// second svg inside the host turns every strict-mode locator ambiguous.
function Grip() {
  return <span className="guide-well-grip" aria-hidden="true" />;
}

// The well strips' class + tooltip line, per orientation. The corner squares
// mint the guide PERPENDICULAR to the pull-out direction, like the strips do:
// pulling down-right from the upper-left corner sweeps a / across the canvas
// (a \ would sit still under that drag — its intercept is constant along it).
const WELLS: Record<GuideOrientation, { cls: string; hint: string }> = {
  horizontal: { cls: 'guide-well-top', hint: 'Drag down to pull out a horizontal guide' },
  vertical: { cls: 'guide-well-left', hint: 'Drag right to pull out a vertical guide' },
  'diagonal-up': {
    cls: 'guide-well-corner-tl',
    hint: 'Drag out to pull a rising diagonal guide',
  },
  'diagonal-down': {
    cls: 'guide-well-corner-bl',
    hint: 'Drag out to pull a falling diagonal guide',
  },
};

/**
 * The guide wells: two slim strips flush with the canvas's top and left edges
 * plus the two corner squares between them. Dragging DOWN out of the top
 * strip pulls a horizontal guide; dragging RIGHT out of the left one pulls a
 * vertical guide; dragging out of the upper-left corner pulls a rising (/)
 * diagonal, out of the lower-left corner a falling (\) one (useGuideDrag owns
 * the gesture). Each also serves as the drop zone that deletes a dragged
 * guide — the same place it came from. Mounted only in idle arrow-mode; every
 * other mode owns the canvas edges (banner frame, placement).
 */
export function GuideWells({
  guidesHidden,
  armed,
  onWellPointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const well = (orientation: GuideOrientation) => {
    const cls =
      'guide-well ' +
      WELLS[orientation].cls +
      (guidesHidden ? ' disabled' : '') +
      (armed === orientation ? ' armed' : '');
    return (
      <div
        className={cls}
        data-guide-well={orientation}
        title={guidesHidden ? 'Guides are hidden (View menu)' : WELLS[orientation].hint}
        onPointerDown={guidesHidden ? undefined : (e) => onWellPointerDown(orientation, e)}
        onPointerMove={guidesHidden ? undefined : onPointerMove}
        onPointerUp={guidesHidden ? undefined : onPointerUp}
      >
        <Grip />
      </div>
    );
  };
  return (
    <>
      {well('horizontal')}
      {well('vertical')}
      {well('diagonal-up')}
      {well('diagonal-down')}
    </>
  );
}
