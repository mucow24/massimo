import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { AlignmentGuide } from '../model/types';

// Stroke/hit sizes in SCREEN px (÷ zoom at use) — the line-circle recipe
// verbatim, so all scaffolding speaks one visual language.
const GUIDE_STROKE_PX = 1.25;
const GUIDE_DASH_PX = 5;
const HIT_PX = 12;

interface Props {
  guide: AlignmentGuide;
  zoom: number;
  // The box the guide must span — the OVERDRAWN viewBox (one viewport of
  // slack per side, like the Grid), so a mid-gesture pan or zoom can't reveal
  // an end of a line that has none.
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  guideColor: string;
  accentColor: string;
  selected: boolean;
  // The shared hoveredChrome affordance (idle, not panning, not selected).
  hovered: boolean;
  // A drag or placement is snap-ENGAGED on this guide right now: paint it
  // full accent. The loud half of the feedback — halo, dashed accent span,
  // snap-point ring, coordinate chip — rides the SnapGuides overlay on top
  // (see EngagedGuideChrome).
  engaged: boolean;
  // False while another mode owns the canvas: visible but takes no pointers.
  interactive: boolean;
  inHandMode: boolean;
  // Selection happens at pointer-down (the drag hook selects before arming).
  onPointerDown?: (e: ReactPointerEvent, id: string) => void;
  // The shared item click contract (Shift toggles membership, plain click
  // replaces); also the deep-pick's synthetic-click way in.
  onClick?: (id: string, e: ReactMouseEvent) => void;
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
}

/**
 * One alignment guide: a dashed line spanning the whole (overdrawn) canvas in
 * the scaffolding style (export-excluded by the layer that mounts this).
 * Selection recolors it in the interaction accent; a mouseover previews that
 * recolour at half strength; a snap engagement paints it full accent with no
 * further chrome. The invisible fat stroke is the grab surface — and unlike a
 * locked ring's rim, it stays MOUNTED (pointer-events none) on a locked,
 * unselected guide: the marquee never sweeps guides, so the alt-click
 * deep-pick is a locked guide's only pointer recovery, and its synthetic
 * click needs this element to land on (see hitStack's lockedDispatchTarget).
 */
export function GuideView({
  guide,
  zoom,
  vbX,
  vbY,
  vbW,
  vbH,
  guideColor,
  accentColor,
  selected,
  hovered,
  engaged,
  interactive,
  inHandMode,
  onPointerDown,
  onClick,
  onHoverEnter,
  onHoverLeave,
}: Props) {
  const px = (v: number) => v / zoom;
  const clickThrough = !interactive || inHandMode || (guide.locked && !selected);
  const horizontal = guide.orientation === 'horizontal';
  const x1 = horizontal ? vbX : guide.offset;
  const x2 = horizontal ? vbX + vbW : guide.offset;
  const y1 = horizontal ? guide.offset : vbY;
  const y2 = horizontal ? guide.offset : vbY + vbH;
  const stroke = selected || engaged ? accentColor : guideColor;
  const dash = (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={px(GUIDE_STROKE_PX)}
      strokeDasharray={`${px(GUIDE_DASH_PX)} ${px(GUIDE_DASH_PX)}`}
      pointerEvents="none"
    />
  );
  return (
    <g
      data-guide={guide.id}
      // The rect-select gate keys off closest('[data-locked]') so a press on
      // a locked guide's (selected) grab stroke rubber-bands instead of dying.
      data-locked={guide.locked || undefined}
      onPointerEnter={onHoverEnter ? () => onHoverEnter(guide.id) : undefined}
      onPointerLeave={onHoverLeave ? () => onHoverLeave(guide.id) : undefined}
    >
      {dash}
      {/* Mouseover preview: the same line in the accent at half opacity OVER
          the base coat — a restroke would leave it fainter than at rest. */}
      {hovered && !selected && !engaged && (
        <g data-guide-hover={guide.id} opacity={0.5} pointerEvents="none">
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={accentColor}
            strokeWidth={px(GUIDE_STROKE_PX)}
            strokeDasharray={`${px(GUIDE_DASH_PX)} ${px(GUIDE_DASH_PX)}`}
          />
        </g>
      )}
      <line
        data-guide-hit={guide.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={px(HIT_PX)}
        pointerEvents={clickThrough ? 'none' : 'stroke'}
        style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
        onPointerDown={(e) => onPointerDown?.(e, guide.id)}
        onClick={(e) => onClick?.(guide.id, e)}
        // Right-click on a guide has nothing to rotate; swallow it so the
        // gesture doesn't read as a misfire on whatever sits beneath.
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    </g>
  );
}
