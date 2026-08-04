import type { Line, Station, StopOrientation } from '../model/types';
import { ORIENTATION_ANGLE, stationFrameDeg, stopCenterAt } from '../geometry/orientation';
import { stationCircle } from '../geometry/lineCircle';
import { resolveDotSize } from '../model/dotSize';
import { LABEL_FONT_SIZE_DEFAULT, stationIsSingleton } from '../model/transforms';
import { useRenderDoc } from '../state/renderDoc';

// World-unit arrow sizing — deliberately no /zoom floor: a wheel zoom commits
// the camera only after the wheel settles, so screen-floored chrome would
// hold stale size mid-gesture and snap on commit (the same reason the
// selection ring holds its weight via vector-effect instead of /zoom).
// Each badge scales off its own dot's painted diameter so an oversized dot
// gets a proportionally bigger arrow, floored at the station-name default
// font size so a default 8px dot's badge still reads at a glance.
const ARROW_SCALE = 1.2;
const ARROW_SIZE_MIN = LABEL_FONT_SIZE_DEFAULT;

// Proportions of the drawn arrow, as fractions of its tip-to-tip length.
const HEAD_LENGTH = 0.3;
const HEAD_HALF_WIDTH = 0.2;
const SHAFT_HALF_WIDTH = 0.06;

/**
 * World-unit size (tip to tip) of the MAP's hover badge on one stop: scaled off
 * that stop's painted dot so an oversized dot can't swallow its arrow, floored
 * at the station-name default size so a default 8px dot's badge still reads.
 *
 * Deliberately NOT what the layout editor uses. There the arrow has to fit
 * inside its grab ring, so it sizes off the RING (see `ARROW_FIT` in
 * StationLayoutEditor) — a service-code disc would otherwise scale the arrow
 * straight through the ring it lives in. So the two surfaces share the shape
 * and the rotation, not the size, and entering the mode can resize a badge.
 */
function orientationArrowSize(
  line: Line | undefined,
  stop: Station['stops'][number],
  isSingleton: boolean,
): number {
  return Math.max(resolveDotSize(line, stop, isSingleton) * ARROW_SCALE, ARROW_SIZE_MIN);
}

const round = (v: number) => +v.toFixed(2);

/**
 * A double-headed arrow `size` long tip to tip, centered on the origin and
 * pointing up/down. Rotated by ORIENTATION_ANGLE onto a stop's axis — which is
 * the point of drawing it rather than typesetting ↕ ⤢ ↔ ⤡, whose diagonals no
 * font puts at a true 45° (see ORIENTATION_ANGLE).
 */
export function orientationArrowPath(size: number): string {
  const half = round(size / 2);
  const hw = round(size * HEAD_HALF_WIDTH);
  const sw = round(size * SHAFT_HALF_WIDTH);
  const top = round(-size / 2 + size * HEAD_LENGTH);
  const bot = round(size / 2 - size * HEAD_LENGTH);
  return [
    `M0 ${-half}`,
    `L${-hw} ${top}`,
    `L${-sw} ${top}`,
    `L${-sw} ${bot}`,
    `L${-hw} ${bot}`,
    `L0 ${half}`,
    `L${hw} ${bot}`,
    `L${sw} ${bot}`,
    `L${sw} ${top}`,
    `L${hw} ${top}`,
    'Z',
  ].join('');
}

/**
 * One stop's axis arrow, drawn at (x, y) in the station's rotated frame.
 * `outline` adds the two-tone contrast halo the map hover badges use; the
 * layout editor omits it (its ring scrim already darkens the dot underneath).
 * `viaCircle` swaps the arrow for a ring — the direction cycle's Circle state
 * (the stop rides its station's line circle), which has no axis to point.
 */
export function OrientationArrow({
  x,
  y,
  size,
  orientation,
  lineId,
  fill,
  outline,
  viaCircle,
}: {
  x: number;
  y: number;
  size: number;
  orientation: StopOrientation;
  lineId: string;
  fill: string;
  outline?: string;
  viaCircle?: boolean;
}) {
  if (viaCircle) {
    const r = round(size * 0.33);
    const w = round(size / 8);
    return (
      <g data-arrow-line={lineId} data-arrow-axis="circle" pointerEvents="none">
        {outline && (
          <circle cx={x} cy={y} r={r} fill="none" stroke={outline} strokeWidth={w * 2.4} />
        )}
        <circle cx={x} cy={y} r={r} fill="none" stroke={fill} strokeWidth={w} />
      </g>
    );
  }
  return (
    <path
      data-arrow-line={lineId}
      // The axis in words. The shape carries it only as a rotation, which is
      // unreadable from a test or the elements panel.
      data-arrow-axis={orientation}
      d={orientationArrowPath(size)}
      transform={`translate(${x} ${y}) rotate(${ORIENTATION_ANGLE[orientation]})`}
      fill={fill}
      stroke={outline}
      strokeWidth={outline ? size / 8 : undefined}
      strokeLinejoin="round"
      paintOrder="stroke"
      pointerEvents="none"
    />
  );
}

/**
 * Mouseover orientation badges: the layout editor's axis arrow on each stop dot
 * of the hovered station, so stop orientation reads at a glance without
 * entering the editor. Rendered inside the station-rotated frame, so the arrows
 * always show the world-true axis (same trick as the editor's handles).
 * Two-tone white-core/black-edge — the selection ring's recipe — stays legible
 * on a dot body of any color over any canvas.
 */
export function StationOrientationArrows({
  station,
  lines,
}: {
  station: Station;
  lines: Record<string, Line>;
}) {
  const isSingleton = stationIsSingleton(station);
  // Each badge is drawn at its stop's CELL, so the group turns with the frame
  // those cells resolve through — the ring's on a bound station.
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const angle = stationFrameDeg(station, stationCircle(station, lineCircles));
  return (
    <g
      data-station-arrows={station.id}
      transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
      pointerEvents="none"
    >
      {station.stops.map((s) => {
        const c = stopCenterAt(s.row, s.col);
        return (
          <OrientationArrow
            key={s.lineId}
            x={c.x}
            y={c.y}
            size={orientationArrowSize(lines[s.lineId], s, isSingleton)}
            orientation={s.orientation}
            lineId={s.lineId}
            fill="#fff"
            outline="#000"
            viaCircle={s.viaCircle}
          />
        );
      })}
    </g>
  );
}
