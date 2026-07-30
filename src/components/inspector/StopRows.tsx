import { useEffect, useRef } from 'react';
import type { Line, LineId, Station, StopCell } from '../../model/types';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import { AXIS_CYCLE, resolveDotStyle, stationIsSingleton } from '../../model/transforms';
import { DOT_SIZE_MIN, DOT_SIZE_STEP, resolveDotSize } from '../../model/dotSize';
import { lineDisplayName } from '../../model/lineNaming';
import { legibleTextOn } from '../../util/color';
import { Cross2Icon } from '@radix-ui/react-icons';
import { AnchorGlyph } from '../AnchorGlyph';
import { StationShapePicker } from '../StationShapePicker';
import { LineEndSelect } from '../LineEndPicker';
import { stationEndStyleOf } from '../../model/lineEnd';
import { isLineTerminus } from '../../model/lineTopology';
import { useNumericField } from '../useNumericField';
import { ORIENTATION_NAME } from './stopGridDrag';
import type { Rotation } from '../../geometry/orientation';

/**
 * One editor row per stop: [service badge | shape picker | dot size | line-end
 * picker | orientation cycle button] — matching the
 * Line/Type/Size/End/Direction header the station inspector puts above them.
 * The end slot is the one that isn't always filled: only a TERMINUS can pin an
 * end, so elsewhere the row holds the column open with a placeholder so the
 * columns stay aligned down the list. Always enabled otherwise —
 * no click-a-dot-first ritual; the row IS the per-stop control surface.
 * Clicking a row also selects its stop (lighting the canvas layout-editor ring
 * + arming keyboard nudge), and hovering highlights the corresponding dot on
 * the map via the same hoveredLineStop channel the line inspector uses.
 */
export function StopRows({ station, lines }: { station: Station; lines: Record<string, Line> }) {
  const rows = station.stops
    .slice()
    .sort((a, b) => a.row - b.row || a.col - b.col || a.lineId.localeCompare(b.lineId));
  const anchors = station.transferAnchors ?? [];
  if (rows.length === 0 && anchors.length === 0) return null;
  return (
    <div>
      {rows.map((s) => (
        <StopRow key={s.lineId} station={station} stop={s} line={lines[s.lineId]} />
      ))}
      {/* Transfer anchors listed BENEATH the stops rather than interleaved:
          they share the station's cell grid but none of a stop's controls (no
          line, no dot type, no size, no orientation), so sorting them into the
          same (row, col) order would only make the columns look broken. */}
      {anchors.map((a) => (
        <AnchorRow key={a.id} station={station} anchorId={a.id} />
      ))}
    </div>
  );
}

/** One row per hosted transfer anchor: a label and a delete button. This is
 *  where an anchor is REMOVED — it has no popover of its own, and its only
 *  other edit (position) happens by dragging it in the layout editor. */
function AnchorRow({ station, anchorId }: { station: Station; anchorId: string }) {
  const selection = useSelection();
  const deleteStationAnchor = useDoc((d) => d.deleteStationAnchor);
  const selected = selection.selectedAnchorCellId === anchorId;
  return (
    <div
      data-testid="anchor-row"
      className={'stop-row anchor-row' + (selected ? ' selected' : '')}
      onClick={() => selection.setSelectedAnchorCellId(anchorId)}
    >
      <span className="line-badge anchor-badge" title="Transfer anchor">
        <AnchorGlyph />
      </span>
      <span className="anchor-row-name">Transfer anchor</span>
      <button
        type="button"
        className="chip-btn"
        aria-label="Delete transfer anchor"
        title="Delete this transfer anchor (and any transfers bound to it)"
        onClick={(e) => {
          e.stopPropagation();
          if (selected) selection.setSelectedAnchorCellId(null);
          deleteStationAnchor(station.id, anchorId);
        }}
      >
        <Cross2Icon aria-hidden="true" />
      </button>
    </div>
  );
}

// Screen angle (deg CW from vertical) of each local axis index; the world
// axis of index i on a rotated station is i + rotation (AXIS_CYCLE entries
// are 45° CW apart, matching the station rotation step).
const AXIS_ANGLE = 45;

/** The Circle state of the direction cycle: the stop rides its station's
 *  line circle (StopCell.viaCircle). A ring, where the axes are arrows. */
function CircleDirIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <circle
        cx="7.5"
        cy="7.5"
        r="4.7"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeDasharray="2.2 1.6"
        fill="none"
      />
    </svg>
  );
}

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
  const setStationEndStyle = useDoc((d) => d.setStationEndStyle);
  const lineId = stop.lineId as LineId;
  const stationId = station.id;
  const selected = selection.selectedStopLineId === lineId;
  const rotation = (station.rotation % 4) as Rotation;
  // The row shows what this stop actually renders — its singleton or shared
  // default (a per-station property), unless the stop pins its own override.
  const isSingleton = stationIsSingleton(station);
  // Dash (tick) dimensions derive from the line width (+ per-line overrides
  // in the line inspector); the per-stop dot size is inert for them.
  const isDash = resolveDotStyle(line, stop, isSingleton).shape === 'dash';
  // Is this stop one of the line's ENDS? Only there does an end style mean
  // anything — and only there will a pin survive the next topology change.
  const isTerminus = !!line && isLineTerminus(line, stationId);

  const {
    text: sizeText,
    attachWheel: attachSizeWheel,
    onNumberFocus: onSizeFocus,
    onNumberChange: onSizeChange,
    onNumberBlur: onSizeBlur,
  } = useNumericField(
    resolveDotSize(line, stop, isSingleton),
    // dotSize is rotation-invariant — no per-match transform. Writing the
    // line's effective default back clears the override (setDotSize contract).
    (n) => dispatchMirrored(stationId, (sid) => setDotSize(sid, lineId, n)),
    () => {
      const doc = useDoc.getState();
      const liveStation = doc.stations[stationId];
      return resolveDotSize(
        doc.lines[lineId],
        liveStation?.stops.find((c) => c.lineId === lineId),
        stationIsSingleton(liveStation),
      );
    },
    DOT_SIZE_STEP,
  );

  // Orientation axes live in the station's LOCAL frame; show the WORLD-true
  // axis so the control never contradicts the canvas.
  const worldIdx = (AXIS_CYCLE.indexOf(stop.orientation) + rotation) % 4;
  // The direction cycle's fifth state: this stop rides its station's line
  // circle. Shown as a ring; clicking steps into the four axes (and, where a
  // circular connection is possible, the axes wrap back to Circle).
  const isCircleDir = !!stop.viaCircle;
  const worldName = isCircleDir ? 'Circle' : ORIENTATION_NAME[AXIS_CYCLE[worldIdx]];

  // The dot highlight rides NATIVE mouseenter/mouseleave, not React's synthetic
  // pair. React's follows the REACT tree, where the end-style panel — portaled
  // out to `.app` — counts as INSIDE this row: the pointer walking into it
  // re-entered the row instead of leaving it, and the panel then unmounted
  // under the cursor with no leave left to fire, stranding a white highlight on
  // the canvas for good. Native enter/leave follow the DOM, where the portal is
  // plainly outside, so opening the panel darkens the highlight and picking an
  // option can't strand one. Controls that live in the row's own DOM (the shape
  // grid) still keep it lit while they're open.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const enter = () => useSelection.getState().setHoveredLineStop({ lineId, stationId });
    const leave = () => {
      const sel = useSelection.getState();
      const cur = sel.hoveredLineStop;
      if (cur && cur.stationId === stationId && cur.lineId === lineId) sel.setHoveredLineStop(null);
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
    };
  }, [stationId, lineId]);

  return (
    <div
      ref={rowRef}
      data-testid="stop-row"
      className={'stop-row' + (selected ? ' selected' : '')}
      onClick={() => selection.setSelectedStopLineId(lineId)}
    >
      {/* The badge names the stop's line — and double-clicking it goes there,
          into that line's editor (startAppend, the one line-editor entry). The
          single clicks on the way just select this row's stop, so the hop
          leaves nothing behind. */}
      <span
        className="line-badge"
        style={{ background: line?.color ?? '#888', color: legibleTextOn(line?.color ?? '#888') }}
        title={
          line ? `${lineDisplayName(line)} — double-click to edit this line` : lineDisplayName(line)
        }
        onDoubleClick={() => {
          if (line) selection.startAppend(lineId);
        }}
      >
        {line?.service ?? '?'}
      </span>
      <StationShapePicker
        disabled={false}
        currentStyle={resolveDotStyle(line, stop, isSingleton)}
        lineColor={line?.color}
        serviceCode={line?.service}
        onPick={(styleId) =>
          // dotStyle is rotation-invariant — no per-match transform.
          dispatchMirrored(stationId, (sid) => setDotStyle(sid, lineId, styleId))
        }
      />
      <input
        type="number"
        aria-label="Stop dot size"
        title={
          isDash ? 'Dash size follows the line width (see line inspector)' : 'Stop dot size (px)'
        }
        disabled={isDash}
        min={DOT_SIZE_MIN}
        step={DOT_SIZE_STEP}
        value={sizeText}
        // attachWheel binds a non-passive native wheel listener (React's
        // onWheel is passive, so its preventDefault would warn + no-op).
        // Omit it while disabled (dash) — browsers still deliver wheel events
        // to disabled inputs, and the handler writes the doc (same guard as
        // NumericFieldRow).
        ref={isDash ? undefined : attachSizeWheel}
        onFocus={onSizeFocus}
        onChange={onSizeChange}
        onBlur={onSizeBlur}
      />
      {/* Per-terminus END style, only where this stop IS one of the line's
          ends — the slot is held open (but empty) elsewhere so the row's
          columns stay aligned down the list. Shows the RESOLVED end, so
          picking the line's own value clears the pin rather than storing it
          (setStationEndStyle's contract, same as the size box above).
          Deliberately NOT mirrored: unlike dot type and size, an end is a
          property of this line's topology here, not a look to spread across
          matching stations. */}
      {isTerminus ? (
        <LineEndSelect
          value={stationEndStyleOf(line, stationId)}
          ariaLabel={`Line end (line ${line?.service ?? '?'})`}
          onSelect={(end) => setStationEndStyle(lineId, stationId, end)}
        />
      ) : (
        <span className="end-style-placeholder" aria-hidden="true" />
      )}
      {/* One-step cycle, like right-click / R on the canvas handle. Cycling
          is frame-invariant across mirror matches (each steps from its OWN
          current axis), so a rotated match keeps its world-equivalent
          orientation AND the match group survives. The row's own onClick
          selects the stop as the click bubbles. */}
      <button
        type="button"
        className="chip-btn orient-btn"
        aria-label={`Stop orientation (line ${line?.service ?? '?'}): ${worldName}`}
        title={
          isCircleDir
            ? 'Riding the line circle — click to rotate to an axis instead'
            : `Stop axis ${worldName} — click to rotate 45°`
        }
        onClick={() => dispatchMirrored(stationId, (sid) => rotateStop(sid, lineId))}
      >
        {isCircleDir ? (
          <CircleDirIcon />
        ) : (
          <OrientationArrowIcon angleDeg={worldIdx * AXIS_ANGLE} />
        )}
      </button>
    </div>
  );
}
