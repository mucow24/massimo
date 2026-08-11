import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GuideOrientation } from '../../model/types';
import { useThemeColors } from '../../state/theme';

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

/**
 * The guide wells: two slim strips flush with the canvas's top and left edges.
 * Dragging DOWN out of the top strip pulls a horizontal guide; dragging RIGHT
 * out of the left one pulls a vertical guide (useGuideDrag owns the gesture).
 * Each also serves as the drop zone that deletes a dragged guide — the same
 * place it came from. Mounted only in idle arrow-mode; every other mode owns
 * the canvas edges (banner frame, placement).
 *
 * HTML, but sitting ON the canvas, so the ink follows the PAPER rather than the
 * chrome's `data-theme`: "Dark UI in day" darkens the toolbar over a still-light
 * map, and a dimmed day paper darkens the map under a still-light toolbar.
 * `darkPaper` (theme.ts) is that question already answered; styles.css hangs the
 * night values off the class.
 */
export function GuideWells({
  guidesHidden,
  armed,
  onWellPointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const darkPaper = useThemeColors().darkPaper;
  const well = (orientation: GuideOrientation) => {
    const horizontal = orientation === 'horizontal';
    const cls =
      'guide-well ' +
      (horizontal ? 'guide-well-top' : 'guide-well-left') +
      (darkPaper ? ' dark-paper' : '') +
      (guidesHidden ? ' disabled' : '') +
      (armed === orientation ? ' armed' : '');
    return (
      <div
        className={cls}
        data-guide-well={orientation}
        title={
          guidesHidden
            ? 'Guides are hidden (View menu)'
            : horizontal
              ? 'Drag down to pull out a horizontal guide'
              : 'Drag right to pull out a vertical guide'
        }
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
    </>
  );
}
