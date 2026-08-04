import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { LineCircle } from '../model/types';
import { CIRCLE_CARDINAL_ANGLES } from '../geometry/lineCircle';

// Rim affordance sizes, all in SCREEN px (÷ zoom at use), matching the
// selection-chrome convention (selectionStyle.ts): the guide reads the same
// at every zoom.
const GUIDE_STROKE_PX = 1.25;
const GUIDE_DASH_PX = 5;
const RIM_HIT_PX = 12;
const KNOB_HALF_PX = 4;
// Cardinal ticks: solid and a touch heavier than the dashed ring, so they read
// as marks ON the guide rather than more of it, and straddling the rim so the
// mark is legible whether it lands on a dash or in a gap.
const CARDINAL_TICK_PX = 4;
const CARDINAL_STROKE_PX = 1.5;
// Centre handle: a small ⊕ — ring plus crossing arms — at the circle's centre,
// and the transparent disc that grabs it. Drawn at the cardinals' weight so it
// reads as one more mark on the guide rather than a new kind of object. The hit
// disc is deliberately wider than the glyph: the mark wants to stay small and
// quiet, the target wants to be catchable.
const CENTER_RING_PX = 3.5;
const CENTER_ARM_PX = 5.5;
const CENTER_STROKE_PX = 1.5;
const CENTER_HIT_PX = 8;

export type LineCirclePart = 'rim' | 'knob' | 'center';

interface Props {
  circle: LineCircle;
  zoom: number;
  guideColor: string;
  accentColor: string;
  selected: boolean;
  // The pointer is on one of this circle's grab surfaces, and the shared
  // hoveredChrome gate has cleared the preview (idle mode, not panning, not
  // already selected) — so paint the "you can click this" half-selection.
  hovered: boolean;
  // False while another mode owns the canvas (placement, append, layout edit):
  // the guide stays visible but takes no pointer events.
  interactive: boolean;
  inHandMode: boolean;
  // "Snap to circle cardinals" is on: mark the eight seats the snap will pull
  // to. Passed in rather than read here so the view stays dumb — and because
  // the mode is a UI pref, never part of the circle.
  showCardinals: boolean;
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
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
}

/**
 * The painted guide — dashed ring, optional cardinal ticks, centre ⊕ — in one
 * stroke colour. Its own component because the mouseover affordance is a SECOND
 * copy of exactly this set in the accent (see below), and the geometry is worth
 * stating once. Never takes pointer events: the grab surfaces are separate,
 * invisible, and drawn after these, so no mark can shadow a grab.
 */
function GuideMarks({
  circle,
  zoom,
  stroke,
  showCardinals,
  markId,
}: {
  circle: LineCircle;
  zoom: number;
  stroke: string;
  showCardinals: boolean;
  // Stamped on the individually addressable marks. Omitted for the hover copy,
  // so each data attribute keeps naming exactly one element.
  markId?: string;
}) {
  const px = (v: number) => v / zoom;
  const tick = px(CARDINAL_TICK_PX);
  return (
    <>
      <circle
        cx={circle.x}
        cy={circle.y}
        r={circle.radius}
        fill="none"
        stroke={stroke}
        strokeWidth={px(GUIDE_STROKE_PX)}
        strokeDasharray={`${px(GUIDE_DASH_PX)} ${px(GUIDE_DASH_PX)}`}
        pointerEvents="none"
      />
      {showCardinals && (
        <g data-line-circle-cardinals={markId} pointerEvents="none">
          {CIRCLE_CARDINAL_ANGLES.map((t, k) => {
            const ux = Math.cos(t);
            const uy = Math.sin(t);
            return (
              <line
                key={k}
                x1={circle.x + (circle.radius - tick) * ux}
                y1={circle.y + (circle.radius - tick) * uy}
                x2={circle.x + (circle.radius + tick) * ux}
                y2={circle.y + (circle.radius + tick) * uy}
                stroke={stroke}
                strokeWidth={px(CARDINAL_STROKE_PX)}
              />
            );
          })}
        </g>
      )}
      {/* The ⊕ itself: one translate carries the whole glyph, so the centre is
          stated once. */}
      <g
        data-line-circle-center-mark={markId}
        transform={`translate(${circle.x} ${circle.y})`}
        fill="none"
        stroke={stroke}
        strokeWidth={px(CENTER_STROKE_PX)}
        pointerEvents="none"
      >
        <circle r={px(CENTER_RING_PX)} />
        <line x1={-px(CENTER_ARM_PX)} y1={0} x2={px(CENTER_ARM_PX)} y2={0} />
        <line x1={0} y1={-px(CENTER_ARM_PX)} x2={0} y2={px(CENTER_ARM_PX)} />
      </g>
    </>
  );
}

/**
 * One line circle: a dashed guide ring (editor scaffolding — the layer that
 * mounts this carries `data-export-exclude`, so it never prints). Selection
 * paints the ring in the interaction accent and grows a square resize knob on
 * the rim's east point, and a mouseover previews that recolour at half strength
 * (the canvas-wide affordance, gated by `hoveredChrome`); the invisible fat rim
 * stroke is the grab surface for select + move. A locked, unselected circle is
 * click-through, like every other locked kind — and, having no grab surface,
 * cannot be hovered either.
 *
 * The ⊕ at the centre is a SECOND grab for the same select+move, because the rim
 * is covered BY CONSTRUCTION: carrying a line is what a ring is for, this layer
 * paints below all map content, and so a line riding the first lane puts the
 * grab stroke and the resize knob under the band together. The centre is not
 * empty by construction — a ring drawn round a city centre encloses the densest
 * ink on the map — it is merely the part that usually is not covered, and that
 * asymmetry is the whole argument.
 *
 * A buried ring was already SELECTABLE before this handle: the alt-click
 * deep-pick resolves `data-line-circle-rim` and `elementsFromPoint` reports the
 * whole stack regardless of overlap, so alt-clicking the band cycles line →
 * lineCircle and opens the popover, which carries radius and lock. What the
 * handle adds is narrower and real:
 *
 *   - a PLAIN-CLICK grab, discoverable and aimed at something visible — the
 *     deep-pick needs the alt-cycle habit and a cursor within the rim's 12px
 *     grab stroke, i.e. ±6 screen px of a circumference you cannot see;
 *   - DRAG, which the deep-pick genuinely cannot do: it re-dispatches a click,
 *     never a gesture (see MapCanvas), so a buried ring could be selected but
 *     not moved.
 *
 * It does NOT unbury the resize knob, which stays on the rim's east point and
 * stays under the band. Under a line, resize is popover-only.
 *
 * Three ways the handle is itself unreachable, all of them recoverable by
 * alt-click (every surface keeps its own id, so both stay in the cycle):
 *   - another line crossing the middle, or a hub station parked on the centre,
 *     buries it exactly as the band buries the rim;
 *   - CONCENTRIC rings put their discs and their ⊕ glyphs at the same point:
 *     DOM order picks the winner, and the loser is both unclickable and
 *     invisible, since the two glyphs draw on top of each other;
 *   - the View menu's Line circles toggle, which is the deliberate escape.
 *
 * Two deliberate divergences from the rest of the canvas. The glyph keeps
 * painting when it cannot be grabbed (locked, hand mode, another mode owning the
 * canvas) — every other handle in the app, e.g. SvgImageView's, appears only on
 * selection; this one is scaffolding first, like the dashed ring it sits inside.
 * And because this layer paints ABOVE the background band, each ring now puts a
 * 16px screen-px dead spot over any polygon or image beneath its centre: clicks
 * and marquee-starts there take the ring. The rim already does this along its
 * whole circumference, so it is more of the same rather than new in kind.
 */
export function LineCircleView({
  circle,
  zoom,
  guideColor,
  accentColor,
  selected,
  hovered,
  interactive,
  inHandMode,
  showCardinals,
  onPointerDown,
  onClick,
  onContextMenu,
  onHoverEnter,
  onHoverLeave,
}: Props) {
  const px = (v: number) => v / zoom;
  const clickThrough = !interactive || inHandMode || (circle.locked && !selected);
  const knobHalf = px(KNOB_HALF_PX);
  const strokeColor = selected ? accentColor : guideColor;
  return (
    <g
      data-line-circle={circle.id}
      // On the wrapper, not on each grab surface: the rect-select gate keys off
      // closest('[data-locked]'), so one mark covers the rim and the ⊕ alike.
      // A locked SELECTED ring keeps both grabs, the drag hook then refuses,
      // and without this the press would be dead rather than rubber-banding —
      // the recovery path every other lockable kind offers.
      data-locked={circle.locked || undefined}
      // Enter/leave on the WRAPPER rather than on each grab surface: the rim
      // and the ⊕ are two grabs for one object, so this is one wiring point
      // instead of three, with no chance of missing one. The knob is the only
      // other hittable child and it does fire this pair — harmlessly, since it
      // exists only while the circle is selected, which is exactly where
      // hoveredChrome suppresses the preview. Every painted mark is
      // pointerEvents="none", and a click-through circle has no grab surface at
      // all, so neither can raise a hover.
      onPointerEnter={onHoverEnter ? () => onHoverEnter(circle.id) : undefined}
      onPointerLeave={onHoverLeave ? () => onHoverLeave(circle.id) : undefined}
    >
      <GuideMarks
        circle={circle}
        zoom={zoom}
        stroke={strokeColor}
        showCardinals={showCardinals}
        markId={circle.id}
      />
      {/* Mouseover preview: the SAME marks in the accent at half opacity, over
          the guide-coloured set rather than instead of it — the selection here
          is a recolour, so a hover that merely restroked would leave the ring
          fainter than at rest. Composited, it reads as half-way to selected.
          The resize knob is excluded, like every other item's manipulators. */}
      {hovered && (
        <g data-line-circle-hover={circle.id} opacity={0.5} pointerEvents="none">
          <GuideMarks
            circle={circle}
            zoom={zoom}
            stroke={accentColor}
            showCardinals={showCardinals}
          />
        </g>
      )}
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
      {/* The ⊕'s grab disc. The glyph over it is painted above, with the rest
          of the guide, and takes no pointer events — a mark that ate the press
          would leave the disc inert. */}
      {!clickThrough && (
        <circle
          data-line-circle-center={circle.id}
          cx={circle.x}
          cy={circle.y}
          r={px(CENTER_HIT_PX)}
          fill="transparent"
          stroke="none"
          style={{ cursor: 'move' }}
          onPointerDown={(e) => onPointerDown?.(e, circle.id, 'center')}
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
