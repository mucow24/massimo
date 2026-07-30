import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { LINE_CIRCLE_RADIUS_MIN } from '../model/lineCircle';
import type { LineCircle } from '../model/types';

interface Props {
  circle: LineCircle;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

// Slider bound only; the spinbutton may exceed it (textboxAllowAboveMax), the
// transform floors at the minimum.
const DIAMETER_SLIDER_MAX = 600;

/**
 * The line circle's tiny editor: diameter (the measure the create/resize
 * readouts show — stored as radius underneath), plus the standard lock/delete
 * footer. Everything else about a circle is direct manipulation on the canvas
 * (rim drag moves, knob drag resizes, stations bind by being dropped on it).
 */
export function LineCirclePopover({ circle, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const setLineCircleRadius = useDoc((s) => s.setLineCircleRadius);
  const setLineCircleLocked = useDoc((s) => s.setLineCircleLocked);
  const deleteLineCircle = useDoc((s) => s.deleteLineCircle);

  const locked = circle.locked ?? false;
  return (
    <PopoverShell
      className="bullet-popover line-circle-popover"
      title="Line circle"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <NumericFieldRow
        id="line-circle-diameter"
        label="Diameter"
        min={LINE_CIRCLE_RADIUS_MIN * 2}
        max={DIAMETER_SLIDER_MAX}
        step={0.5}
        value={circle.radius * 2}
        onChange={(d) => setLineCircleRadius(circle.id, d / 2)}
        getCurrent={() => (useDoc.getState().lineCircles[circle.id]?.radius ?? circle.radius) * 2}
        textboxAllowAboveMax
        disabled={locked}
      />
      <PopoverFooter
        noun="line circle"
        locked={locked}
        onToggleLock={() => setLineCircleLocked(circle.id, !locked)}
        onDelete={() => {
          deleteLineCircle(circle.id);
          onClose();
        }}
      />
    </PopoverShell>
  );
}
