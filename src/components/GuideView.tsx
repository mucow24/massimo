import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { guideSegmentInBox } from '../geometry/snap';
import { useLivePendingZoom } from '../state/viewportStore';
import { dashPeriod, isGaplessDash, parseDashPattern, useDevSettings } from '../state/devSettings';
import type { AlignmentGuide, GuideOrientation } from '../model/types';

// How the ink is sized. The recipe is written in SCREEN px at the transition
// zoom, and HYBRID-sized around it: screen-constant zoomed in past that
// reference (where the thin line is what buys precise placement), riding the
// canvas below it (so a zoomed-out overview isn't dominated by giant dashes),
// floored at the min thickness on screen (so it never fades out entirely).
// The whole recipe — core, casing and dashes together — scales as one off the
// CORE's thickness/min pair, so the guide reads proportionally the same at
// every zoom and its casing stops shrinking where the core's floor stops it;
// only the grab stroke is exempt and stays plain screen-constant, since
// hit comfort must not shrink with the ink. The numbers were dialed in by eye
// against a dense map and stay dialable: they live in `useDevSettings`
// (state/devSettings.ts), whose defaults ARE the recipe, and the Developer
// pane's Guide rendering section turns them.
//
// The under-stroke below (its own color, width and dash dials, the width per
// SIDE of the core) comes from the two-tone trick from the selection ring: one
// tone vanished against the wrong body, so the casing carries its own contrast.
// Its color is theme.alignGuideCasing — its own theme slot, a translucent
// near-white on day paper and black on night. Guides paint BELOW map ink, so
// the casing can only ever win against what sits under them — polygons,
// images, the grid — where a solid rail (as the recipe ships it; dialed to the
// core's own pattern it outlines each dash instead) reads against band art. On
// bare paper the day near-white all but disappears into it, and night's black
// disappears outright.

// The grab stroke's screen-constant width — the one part of the guide that is
// sized for the finger rather than the eye.
const HIT_PX = 12;

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
  // The idle one is what a Developer-pane color dial replaces; the states are
  // never overridden (see `stroke` below).
  guideColor: string;
  // The casing under-stroke's color — theme.alignGuideCasing, a fixed
  // translucent near-white on day paper (black on night). Its own theme slot
  // rather than theme.canvasBg: a translucent rail has to read OVER the paper
  // and the band art, not melt into whichever paper is selected. This whole
  // layer is export-excluded, so it sits on the screen side of the export door.
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
 * (export-excluded by the layer that mounts this), riding a casing rail so the
 * dashes stay legible over the background band painted below guides —
 * polygons, images, grid (map ink paints above and simply covers a
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
  // The live recipe. One subscription per mounted guide, and the object's
  // identity only moves when a dial is turned, so idle frames are free.
  const recipe = useDevSettings((s) => s.guide);
  const dashes = parseDashPattern(recipe.dash);
  const casingDashes = parseDashPattern(recipe.casingDash, dashes);
  const px = (v: number) => v / z;
  // The floor as a fraction of the core. A thickness dialed to zero leaves it
  // meaningless — and 0/0 would reach the DOM as stroke-width="NaN" — so the
  // scale just goes unfloored; the ink is invisible either way.
  const floor = recipe.thickness > 0 ? recipe.minThickness / recipe.thickness : 1;
  const scale = Math.min(Math.max(z / (recipe.transitionZoomPercent / 100), floor), 1);
  const ink = (v: number) => (v * scale) / z;
  // The casing is an OUTSET on the core, so a negative dial insets it — the
  // casing then shows only where its dash overhangs the core's. Past
  // half the core's width the pair asks for a negative stroke, which the DOM
  // reads as an invalid attribute rather than as a hidden one; the pane floors
  // the dial there, and this floors the pair the dials can still straddle by
  // thinning the core under a already-inset casing.
  const casingWidth = Math.max(0, recipe.thickness + 2 * recipe.casingThickness);
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
  const along =
    guide.orientation === 'horizontal'
      ? x1
      : guide.orientation === 'vertical'
        ? y1
        : x1 * Math.SQRT2;
  // Each pattern phases on its OWN period: core and casing meet at the anchor
  // (identical patterns therefore stay locked dash-for-dash), and a casing
  // dialed to a different period is anchored just as firmly instead of
  // re-phasing against the core's. Firmly anchored is not the same as in
  // register, though — unequal periods agree at the anchor and walk apart
  // along the line, which is the casing dial's to get wrong, not this math's.
  const phaseOf = (pattern: readonly number[]) => {
    const period = ink(dashPeriod(pattern));
    return ((along % period) + period) % period;
  };
  // A gapless pattern draws as one unbroken stroke, so it goes to the DOM as
  // one — no dasharray at all. Skia does not special-case a zero gap: it walks
  // the pattern dash by dash regardless, and these periods are a fraction of a
  // SCREEN px (1 recipe px × a scale that bottoms out at ⅓) stretched over the
  // overdrawn span, which is thousands of segments per guide per raster —
  // re-paid on every zoom frame and every repaint behind a drag. Identical
  // pixels either way; the pattern is pure cost.
  const dashAttrs = (pattern: readonly number[]) =>
    isGaplessDash(pattern)
      ? { strokeDasharray: undefined, strokeDashoffset: undefined }
      : { strokeDasharray: pattern.map(ink).join(' '), strokeDashoffset: phaseOf(pattern) };
  // Every state is a restroke of the core, so a color dial can only be the
  // IDLE one — an override that swallowed selected/engaged/hover would take
  // the states with it.
  const stroke = selected
    ? selectedColor
    : engaged
      ? accentColor
      : hovered
        ? hoverColor
        : (recipe.color ?? guideColor);
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
        stroke={recipe.casingColor ?? casingColor}
        strokeWidth={ink(casingWidth)}
        {...dashAttrs(casingDashes)}
        pointerEvents="none"
      />
      <line
        data-guide-ink={guide.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={ink(recipe.thickness)}
        {...dashAttrs(dashes)}
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
