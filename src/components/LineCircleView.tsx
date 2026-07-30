import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { LineCircle } from '../model/types';

// Rim affordance sizes, all in SCREEN px (÷ zoom at use), matching the
// selection-chrome convention (selectionStyle.ts): the guide reads the same
// at every zoom.
const GUIDE_STROKE_PX = 1.25;
const GUIDE_DASH_PX = 5;
const RIM_HIT_PX = 12;
const KNOB_HALF_PX = 4;

export type LineCirclePart = 'rim' | 'knob';

interface Props {
  circle: LineCircle;
  zoom: number;
  guideColor: string;
  accentColor: string;
  selected: boolean;
  // False while another mode owns the canvas (placement, append, layout edit):
  // the guide stays visible but takes no pointer events.
  interactive: boolean;
  inHandMode: boolean;
  // Selection happens at pointer-down (the drag hook selects before arming).
  onPointerDown?: (e: ReactPointerEvent, id: string, part: LineCirclePart) => void;
  // The shared item click contract (Shift toggles multi-selection membership,
  // a plain click replaces it, a click synthesized after a drag is ignored).
  // Mostly redundant with the pointer-down selection above — but not entirely:
  // it carries the Shift-toggle, and it is how the alt-click deep-pick selects
  // a buried rim (its synthetic click dispatch; see hitStack RESOLVERS).
  onClick?: (id: string, e: ReactMouseEvent) => void;
  // Right-click = rotate, the same gesture every other canvas item has. Wired
  // on the knob as well as the rim so the knob isn't a dead spot on the ring.
  onContextMenu?: (id: string, e: ReactMouseEvent) => void;
}

/**
 * One line circle: a dashed guide ring (editor scaffolding — the layer that
 * mounts this carries `data-export-exclude`, so it never prints). Selection
 * paints the ring in the interaction accent and grows a square resize knob on
 * the rim's east point; the invisible fat rim stroke is the grab surface for
 * select + move. A locked, unselected circle is click-through, like every
 * other locked kind.
 */
export function LineCircleView({
  circle,
  zoom,
  guideColor,
  accentColor,
  selected,
  interactive,
  inHandMode,
  onPointerDown,
  onClick,
  onContextMenu,
}: Props) {
  const px = (v: number) => v / zoom;
  const clickThrough = !interactive || inHandMode || (circle.locked && !selected);
  const knobHalf = px(KNOB_HALF_PX);
  return (
    <g data-line-circle={circle.id}>
      <circle
        cx={circle.x}
        cy={circle.y}
        r={circle.radius}
        fill="none"
        stroke={selected ? accentColor : guideColor}
        strokeWidth={px(GUIDE_STROKE_PX)}
        strokeDasharray={`${px(GUIDE_DASH_PX)} ${px(GUIDE_DASH_PX)}`}
        pointerEvents="none"
      />
      {!clickThrough && (
        <circle
          data-line-circle-rim={circle.id}
          cx={circle.x}
          cy={circle.y}
          r={circle.radius}
          fill="none"
          stroke="transparent"
          strokeWidth={px(RIM_HIT_PX)}
          style={{ cursor: 'move' }}
          onPointerDown={(e) => onPointerDown?.(e, circle.id, 'rim')}
          onClick={(e) => onClick?.(circle.id, e)}
          onContextMenu={(e) => onContextMenu?.(circle.id, e)}
        />
      )}
      {selected && !circle.locked && (
        <rect
          data-line-circle-knob={circle.id}
          x={circle.x + circle.radius - knobHalf}
          y={circle.y - knobHalf}
          width={knobHalf * 2}
          height={knobHalf * 2}
          fill={accentColor}
          stroke="#ffffff"
          strokeWidth={px(1)}
          style={{ cursor: 'ew-resize' }}
          pointerEvents={clickThrough ? 'none' : 'all'}
          onPointerDown={(e) => onPointerDown?.(e, circle.id, 'knob')}
          onContextMenu={(e) => onContextMenu?.(circle.id, e)}
        />
      )}
    </g>
  );
}
