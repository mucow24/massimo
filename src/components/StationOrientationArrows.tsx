import type { Line, Station } from '../model/types';
import { stopCenterAt } from '../geometry/orientation';
import { resolveDotSize } from '../model/dotSize';
import { LABEL_FONT_SIZE_DEFAULT, stationIsSingleton } from '../model/transforms';
import { ORIENTATION_GLYPH } from './inspector/stopGridDrag';

// World-unit glyph sizing — deliberately no /zoom floor: a wheel zoom commits
// the camera only after the wheel settles, so screen-floored chrome would
// hold stale size mid-gesture and snap on commit (the same reason the
// selection ring holds its weight via vector-effect instead of /zoom).
// Each badge scales off its own dot's painted diameter so an oversized dot
// gets a proportionally bigger arrow, floored at the station-name default
// font size so a default 8px dot's badge still reads at a glance.
const ARROW_FONT_SCALE = 1.2;
const ARROW_FONT_MIN = LABEL_FONT_SIZE_DEFAULT;

/**
 * Mouseover orientation badges: the layout editor's axis glyph (↕ ⤢ ↔ ⤡) on
 * each stop dot of the hovered station, so stop orientation reads at a glance
 * without entering the editor. Rendered inside the station-rotated frame, so
 * the glyphs always show the world-true axis (same trick as the editor's
 * handles). Two-tone white-core/black-edge text — the selection ring's recipe
 * — stays legible on a dot body of any color over any canvas.
 */
export function StationOrientationArrows({
  station,
  lines,
}: {
  station: Station;
  lines: Record<string, Line>;
}) {
  const isSingleton = stationIsSingleton(station);
  const angle = station.rotation * 45;
  return (
    <g
      data-station-arrows={station.id}
      transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
      pointerEvents="none"
    >
      {station.stops.map((s) => {
        const c = stopCenterAt(s.row, s.col);
        const fontSize = Math.max(
          resolveDotSize(lines[s.lineId], s, isSingleton) * ARROW_FONT_SCALE,
          ARROW_FONT_MIN,
        );
        return (
          <text
            key={s.lineId}
            data-arrow-line={s.lineId}
            x={c.x}
            y={c.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={fontSize}
            fontWeight={700}
            fill="#fff"
            stroke="#000"
            strokeWidth={fontSize / 8}
            strokeLinejoin="round"
            paintOrder="stroke"
            style={{ userSelect: 'none' }}
          >
            {ORIENTATION_GLYPH[s.orientation]}
          </text>
        );
      })}
    </g>
  );
}
