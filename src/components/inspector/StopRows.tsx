import type { Line, LineId, Station, StopCell } from '../../model/types';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import { dispatchMirrored, fanOutMirrored } from '../../state/mirrorDispatch';
import { AXIS_CYCLE, resolveDotStyle } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { DOT_SIZE_MIN, resolveDotSize } from '../../model/dotSize';
import { legibleTextOn } from '../../util/color';
import { StationShapePicker } from '../StationShapePicker';
import { useNumericField } from '../useNumericField';
import { ORIENTATION_GLYPH } from './stopGridDrag';
import type { Rotation } from '../../geometry/orientation';

/**
 * One editor row per stop: [service badge | shape picker | dot size |
 * orientation segments]. Always enabled — no click-a-dot-first ritual; the
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

  const setOrientation = (targetIdx: number) => {
    const curIdx = AXIS_CYCLE.indexOf(stop.orientation);
    const steps = (targetIdx - curIdx + 4) % 4;
    if (steps === 0) return;
    // Absolute set = N relative rotateStop cycles. Cycling is frame-invariant
    // across mirror matches (each steps from its OWN current axis), so a
    // rotated match keeps its world-equivalent orientation AND the match
    // group survives — a raw absolute broadcast would rotate odd-offset
    // matches 90° off and dissolve the group. One group for the whole batch.
    const group = beginHistoryGroup();
    fanOutMirrored(stationId, (sid) => {
      for (let k = 0; k < steps; k++) rotateStop(sid, lineId);
    });
    group.commit();
  };

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
      <div
        className="seg-group"
        role="group"
        aria-label={`Stop orientation (line ${line?.service ?? '?'})`}
      >
        {AXIS_CYCLE.map((o, i) => {
          // Orientation axes live in the station's LOCAL frame; show the
          // WORLD-true glyph so the control never contradicts the canvas.
          const worldGlyph = ORIENTATION_GLYPH[AXIS_CYCLE[(i + rotation) % 4]];
          const active = stop.orientation === o;
          return (
            <button
              key={o}
              type="button"
              className={'seg-btn' + (active ? ' active' : '')}
              aria-pressed={active}
              aria-label={`Orientation: ${worldGlyph}`}
              title={`Stop axis ${worldGlyph}`}
              onClick={(e) => {
                e.stopPropagation();
                setOrientation(i);
              }}
            >
              {worldGlyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}
