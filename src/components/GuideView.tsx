import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { guideSegmentInBox } from '../geometry/snap';
import { useLivePendingZoom } from '../state/viewportStore';
import type { AlignmentGuide, GuideOrientation } from '../model/types';

// Ink recipe in SCREEN px at/above GUIDE_REF_ZOOM. The ink is HYBRID-sized:
// screen-constant zoomed in past the reference (where the thin line is what
// buys precise placement), riding the canvas below it (so a zoomed-out
// overview isn't dominated by giant dashes), floored at GUIDE_MIN_PX on
// screen (so it never fades out entirely). The whole recipe — stroke and
// dashes together — scales as one, keeping the rhythm; only the grab stroke
// is exempt and stays plain screen-constant, since hit comfort must not
// shrink with the ink. Numbers dialed in by eye against a dense map.
const GUIDE_STROKE_PX = 1.5;
const GUIDE_DASH_PX = 5;
const GUIDE_GAP_PX = 2;
const GUIDE_MIN_PX = 0.5;
const GUIDE_REF_ZOOM = 2;
// Paper-toned under-stroke per SIDE of the core (the two-tone trick from the
// selection ring: one tone vanished against the wrong body, so the dash
// carries its own contrast). Guides paint BELOW map ink, so the casing can
// only ever win against what sits under them — polygons, images, the grid —
// where it cuts a paper outline around each dash; on bare canvas it
// disappears into the paper it matches.
const GUIDE_CASING_PX = 0.75;
const HIT_PX = 12;
// Derived: the recipe's scale floor, and its repeat length in recipe px.
const MIN_SCALE = GUIDE_MIN_PX / GUIDE_STROKE_PX;
const DASH_PERIOD = GUIDE_DASH_PX + GUIDE_GAP_PX;

// The direction the guide MOVES (its one degree of freedom, perpendicular to
// the line): a / guide slides along NW–SE, a \ along NE–SW.
const MOVE_CURSOR: Record<GuideOrientation, string> = {
  horizontal: 'ns-resize',
  vertical: 'ew-resize',
  'diagonal-up': 'nwse-resize',
  'diagonal-down': 'nesw-resize',
};

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
  // The three-state restroke palette (theme.alignGuide / -Selected / -Hover).
  guideColor: string;
  // The casing under-stroke — theme.canvasBg, the actual paper (it follows
  // the dimmed day papers; this layer is export-excluded, so it sits on the
  // screen side of the export door). NOT theme.underlay, which is
  // export-reaching map paint deliberately frozen white across day papers.
  casingColor: string;
  selectedColor: string;
  hoverColor: string;
  // The interaction accent, worn while a drag is snap-ENGAGED on this guide —
  // matching the snap chrome (halo + dashed span + ring + coordinate chip)
  // that SnapGuides paints on top of it (see EngagedGuideChrome).
  accentColor: string;
  selected: boolean;
  // The shared hoveredChrome affordance (idle, not panning, not selected).
  hovered: boolean;
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
 * One alignment guide: a dashed line spanning the whole (overdrawn) canvas
 * (export-excluded by the layer that mounts this), riding a paper-toned
 * casing so the dashes stay legible over the background band painted below
 * guides — polygons, images, grid (map ink paints above and simply covers a
 * guide it crosses). Selection,
 * hover and snap engagement are each a RESTROKE of the core — selected
 * amber, hover the softened amber, engaged the accent under the snap chrome
 * — rather than an overlay beside the line: a guide has no body to outline,
 * so the color IS the state (the casing never changes; it's background, not
 * state).
 * The invisible fat stroke is the grab surface — and unlike a locked ring's
 * rim, it stays MOUNTED (pointer-events none) on a locked, unselected guide:
 * the marquee never sweeps guides, so the alt-click deep-pick is a locked
 * guide's only pointer recovery, and its synthetic click needs this element
 * to land on (see hitStack's lockedDispatchTarget).
 */
export function GuideView({
  guide,
  zoom,
  vbX,
  vbY,
  vbW,
  vbH,
  guideColor,
  casingColor,
  selectedColor,
  hoverColor,
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
  // The zoom the ink is sized by: the in-flight wheel zoom while a gesture is
  // live, else the committed prop — otherwise the recipe visibly POPS into
  // its new size at the settle commit, ~100ms after the wheel stops. Only
  // zoom frames re-render (see useLivePendingZoom), and only the few mounted
  // guides at that.
  const z = useLivePendingZoom() ?? zoom;
  const px = (v: number) => v / z;
  const scale = Math.min(Math.max(z / GUIDE_REF_ZOOM, MIN_SCALE), 1);
  const ink = (v: number) => (v * scale) / z;
  const clickThrough = !interactive || inHandMode || (guide.locked && !selected);
  // Clipped to the overdrawn box — a diagonal drawn past it would be ink
  // overflow (and a diagonal needs finite endpoints regardless). One that
  // misses the box entirely has nothing to mount.
  const seg = guideSegmentInBox(guide.orientation, guide.offset, vbX, vbY, vbW, vbH);
  if (!seg) return null;
  const { x1, y1, x2, y2 } = seg;
  // Dash phase anchored to the guide's own world point — the (0, offset) /
  // (offset, 0) foot every orientation passes through — instead of the
  // segment start: the overdrawn box re-clips the endpoints on every pan or
  // zoom COMMIT, and a start-anchored pattern re-phases there, a visible dash
  // flicker after each gesture. `along` is the signed distance from the
  // anchor to the segment start along the path direction (×√2 for the
  // diagonals: their x-span foreshortens true length by 1/√2).
  const period = ink(DASH_PERIOD);
  const along =
    guide.orientation === 'horizontal'
      ? x1
      : guide.orientation === 'vertical'
        ? y1
        : x1 * Math.SQRT2;
  const dashOffset = ((along % period) + period) % period;
  const stroke = selected
    ? selectedColor
    : engaged
      ? accentColor
      : hovered
        ? hoverColor
        : guideColor;
  return (
    <g
      data-guide={guide.id}
      // The rect-select gate keys off closest('[data-locked]') so a press on
      // a locked guide's (selected) grab stroke rubber-bands instead of dying.
      data-locked={guide.locked || undefined}
      onPointerEnter={onHoverEnter ? () => onHoverEnter(guide.id) : undefined}
      onPointerLeave={onHoverLeave ? () => onHoverLeave(guide.id) : undefined}
    >
      <line
        data-guide-casing={guide.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={casingColor}
        strokeWidth={ink(GUIDE_STROKE_PX + 2 * GUIDE_CASING_PX)}
        strokeDasharray={`${ink(GUIDE_DASH_PX)} ${ink(GUIDE_GAP_PX)}`}
        strokeDashoffset={dashOffset}
        pointerEvents="none"
      />
      <line
        data-guide-ink={guide.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={ink(GUIDE_STROKE_PX)}
        strokeDasharray={`${ink(GUIDE_DASH_PX)} ${ink(GUIDE_GAP_PX)}`}
        strokeDashoffset={dashOffset}
        pointerEvents="none"
      />
      <line
        data-guide-hit={guide.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={px(HIT_PX)}
        pointerEvents={clickThrough ? 'none' : 'stroke'}
        style={{ cursor: MOVE_CURSOR[guide.orientation] }}
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
