import type { Line, LineId, Station, StopCell } from '../../model/types';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import { AXIS_CYCLE, resolveDotStyle } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { DOT_SIZE_MIN, resolveDotSize } from '../../model/dotSize';
import { legibleTextOn } from '../../util/color';
import { StationShapePicker } from '../StationShapePicker';
import { useNumericField } from '../useNumericField';
import { ORIENTATION_NAME } from './stopGridDrag';
import type { Rotation } from '../../geometry/orientation';

/**
 * One editor row per stop: [service badge | shape picker | dot size |
 * orientation cycle button]. Always enabled — no click-a-dot-first ritual; the
 * row IS the per-stop control surface. Clicking a row also selects its stop
 * (lighting the canvas layout-editor ring + arming keyboard nudge), and
 * hovering highlights the corresponding dot on the map via the same
 * hoveredLineStop channel the line inspector uses.
 */
export function StopRows({ station, lines }: { station: Station; lines: Record<string, Line> }) {
  const rows = station.stops
    .slice()
    .sort((a, b) => a.row - b.row || a.col - b.col || a.lineId.localeCompare(b.lineId));
  if (rows.length === 0) return null;
  return (
    <div>
      {rows.map((s) => (
        <StopRow key={s.lineId} station={station} stop={s} line={lines[s.lineId]} />
      ))}
    </div>
  );
}

// Screen angle (deg CW from vertical) of each local axis index; the world
// axis of index i on a rotated station is i + rotation (AXIS_CYCLE entries
// are 45° CW apart, matching the station rotation step).
const AXIS_ANGLE = 45;

/** Double-headed arrow along the given world axis — one glyph rotated to the
 *  four angles, so the straight and diagonal states are pixel-identical. */
function OrientationArrowIcon({ angleDeg }: { angleDeg: number }) {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <g
        transform={`rotate(${angleDeg} 7.5 7.5)`}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="7.5" y1="2.8" x2="7.5" y2="12.2" />
        <polyline points="5.2,5.1 7.5,2.8 9.8,5.1" />
        <polyline points="5.2,9.9 7.5,12.2 9.8,9.9" />
      </g>
    </svg>
  );
}

function StopRow({ station, stop, line }: { station: Station; stop: StopCell; line?: Line }) {
  const selection = useSelection();
  const setDotStyle = useDoc((d) => d.setDotStyle);
  const setDotSize = useDoc((d) => d.setDotSize);
  const rotateStop = useDoc((d) => d.rotateStop);
  const lineId = stop.lineId as LineId;
  const stationId = station.id;
  const selected = selection.selectedStopLineId === lineId;
  const rotation = (station.rotation % 4) as Rotation;

  const sizeField = useNumericField(
    resolveDotSize(line, stop),
    // dotSize is rotation-invariant — no per-match transform. Writing the
    // line's effective default back clears the override (setDotSize contract).
    (n) => dispatchMirrored(stationId, (sid) => setDotSize(sid, lineId, n)),
    () => {
      const doc = useDoc.getState();
      return resolveDotSize(
        doc.lines[lineId],
        doc.stations[stationId]?.stops.find((c) => c.lineId === lineId),
      );
    },
  );

  // Orientation axes live in the station's LOCAL frame; show the WORLD-true
  // axis so the control never contradicts the canvas.
  const worldIdx = (AXIS_CYCLE.indexOf(stop.orientation) + rotation) % 4;
  const worldName = ORIENTATION_NAME[AXIS_CYCLE[worldIdx]];

  return (
    <div
      data-testid="stop-row"
      className={'stop-row' + (selected ? ' selected' : '')}
      onClick={() => selection.setSelectedStopLineId(lineId)}
      onMouseEnter={() => selection.setHoveredLineStop({ lineId, stationId })}
      onMouseLeave={() => {
        const cur = useSelection.getState().hoveredLineStop;
        if (cur && cur.stationId === stationId && cur.lineId === lineId) {
          selection.setHoveredLineStop(null);
        }
      }}
    >
      <span
        className="line-badge"
        style={{ background: line?.color ?? '#888', color: legibleTextOn(line?.color ?? '#888') }}
        title={line ? `Line ${line.service}` : 'Unknown line'}
      >
        {line?.service ?? '?'}
      </span>
      <StationShapePicker
        disabled={false}
        currentStyle={resolveDotStyle(line, stop)}
        lineColor={line?.color}
        serviceCode={line?.service}
        onPick={(shape) =>
          // dotStyle is rotation-invariant — no per-match transform.
          dispatchMirrored(stationId, (sid) => setDotStyle(sid, lineId, DOT_SHAPE_PRESETS[shape]))
        }
      />
      <input
        type="number"
        aria-label="Stop dot size"
        title="Stop dot size (px)"
        min={DOT_SIZE_MIN}
        step={1}
        style={{ width: 44 }}
        value={sizeField.text}
        onFocus={sizeField.onNumberFocus}
        onChange={sizeField.onNumberChange}
        onWheel={sizeField.onNumberWheel}
        onBlur={sizeField.onNumberBlur}
      />
      {/* One-step cycle, like right-click / R on the canvas handle. Cycling
          is frame-invariant across mirror matches (each steps from its OWN
          current axis), so a rotated match keeps its world-equivalent
          orientation AND the match group survives. The row's own onClick
          selects the stop as the click bubbles. */}
      <button
        type="button"
        className="chip-btn orient-btn"
        aria-label={`Stop orientation (line ${line?.service ?? '?'}): ${worldName}`}
        title={`Stop axis ${worldName} — click to rotate 45°`}
        onClick={() => dispatchMirrored(stationId, (sid) => rotateStop(sid, lineId))}
      >
        <OrientationArrowIcon angleDeg={worldIdx * AXIS_ANGLE} />
      </button>
    </div>
  );
}
