import { Fragment } from 'react';
import type { Line, Station, StationId } from '../../model/types';
import { lineGraphLayout } from './lineGraphLayout';
import { edgeEndpoints } from '../../model/lineTopology';
import { resolveSegmentStyle } from '../../geometry/interlining';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs, HatchPatterns } from '../HatchPatterns';
import { stationNameListText } from '../../geometry/labelTokens';
import { ChevronDownIcon, Cross2Icon } from '@radix-ui/react-icons';

// A column-based ("git graph") rendering of a line's stops in the inspector:
// the trunk runs down lane 0, branches split into lanes to the right that run
// alongside, and a loop closes with a back-edge bowed out in a side lane. Each
// stop is a row (name + controls); the colored connectors between stops are
// clickable to cycle that segment's style. Replaces the old flat band so a
// branchy/looped line reads as its actual shape instead of one confusing list.

const LANE_W = 18;
const ROW_H = 26;
const DOT_R = 5;
const BODY_W = 8; // preview stroke width for the connectors

const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;
const rowY = (row: number) => row * ROW_H + ROW_H / 2;

export interface StationGraphProps {
  line: Line;
  stations: Record<StationId, Station>;
  color: string;
  underlayColor: string;
  isAppending: boolean;
  // The insert cursor is an index into line.stations; a stop is "armed" when the
  // cursor sits on it. `draw` distinguishes insert vs branch mode.
  cursorStationId: StationId | null;
  appendDraw: boolean;
  hovered: { fromStationId: StationId; toStationId: StationId } | null;
  onSelectStation: (sid: StationId) => void;
  onRemoveStation: (sid: StationId) => void;
  onCycleSegment: (a: StationId, b: StationId) => void;
  onInsertAfter: (sid: StationId) => void;
  onBranchFrom: (sid: StationId) => void;
  onHoverSegment: (edge: { from: StationId; to: StationId } | null) => void;
  onHoverStation: (sid: StationId | null) => void;
}

// Connector path from the upper endpoint to the lower one. Same lane → a
// straight vertical; different lanes → drop out of the parent's lane, curve
// into the child's lane just below the branch, then run straight down.
function treePath(fromLane: number, fromRow: number, toLane: number, toRow: number): string {
  const x1 = laneX(fromLane);
  const y1 = rowY(fromRow);
  const x2 = laneX(toLane);
  const y2 = rowY(toRow);
  if (fromLane === toLane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const bendY = y1 + ROW_H; // finish the sideways move one row below the split
  const midY = (y1 + bendY) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${bendY} L ${x2} ${y2}`;
}

// A loop back-edge: leave the lower stop, bow out into the side lane, run up,
// and curve back into the upper stop — so the closure reads as an arc alongside.
function loopPath(
  fromLane: number,
  fromRow: number,
  toLane: number,
  toRow: number,
  sideLane: number,
): string {
  const ux = laneX(fromLane);
  const uy = rowY(fromRow); // upper stop
  const lx = laneX(toLane);
  const ly = rowY(toRow); // lower stop
  const sx = laneX(sideLane);
  return `M ${lx} ${ly} C ${sx} ${ly} ${sx} ${ly - ROW_H / 2} ${sx} ${(ly + uy) / 2} C ${sx} ${uy + ROW_H / 2} ${sx} ${uy} ${ux} ${uy}`;
}

export function StationGraph(props: StationGraphProps) {
  const {
    line,
    stations,
    color,
    underlayColor,
    isAppending,
    cursorStationId,
    appendDraw,
    hovered,
    onSelectStation,
    onRemoveStation,
    onCycleSegment,
    onInsertAfter,
    onBranchFrom,
    onHoverSegment,
    onHoverStation,
  } = props;

  const layout = lineGraphLayout(line);
  const gutterW = layout.laneCount * LANE_W;
  const totalH = layout.nodes.length * ROW_H;
  const needsHatch = line.edges.some((e) => {
    const s = resolveSegmentStyle(line, e);
    return s === 'hatched' || s === 'hatched-mirror';
  });

  const isHoveredEdge = (a: StationId, b: StationId) =>
    !!hovered &&
    ((hovered.fromStationId === a && hovered.toStationId === b) ||
      (hovered.fromStationId === b && hovered.toStationId === a));

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* The graph gutter, painted behind the rows. */}
      <svg
        width={gutterW}
        height={totalH}
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
      >
        {needsHatch && (
          <defs>
            <HatchPatterns colors={[color]} underlayColor={underlayColor} />
          </defs>
        )}
        {/* Connectors first, dots on top. */}
        {layout.edges.map((e) => {
          const [a, b] = edgeEndpoints(e.pairKey);
          const style = resolveSegmentStyle(line, e.pairKey);
          const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
            style,
            color,
            BODY_W,
          );
          const underlay = lineStyleUnderlayAttrs(style, underlayColor);
          const d =
            e.kind === 'loop'
              ? loopPath(e.fromLane, e.fromRow, e.toLane, e.toRow, e.sideLane ?? layout.laneCount)
              : treePath(e.fromLane, e.fromRow, e.toLane, e.toRow);
          const filter = isHoveredEdge(a, b) ? 'brightness(1.4) saturate(1.2)' : undefined;
          return (
            <Fragment key={e.pairKey}>
              {underlay && (
                <path
                  d={d}
                  fill="none"
                  stroke={underlay.stroke}
                  strokeWidth={BODY_W}
                  strokeLinecap={underlay.strokeLinecap}
                  strokeLinejoin="round"
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={BODY_W}
                strokeLinecap={strokeLinecap}
                strokeLinejoin="round"
                strokeDasharray={strokeDasharray}
                style={{ filter }}
              />
              {/* Wide transparent hit-target to cycle this segment's style. */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(BODY_W + 8, 14)}
                style={{ cursor: 'pointer' }}
                onClick={() => onCycleSegment(a, b)}
                onMouseEnter={() => onHoverSegment({ from: a, to: b })}
                onMouseLeave={() => onHoverSegment(null)}
              >
                <title>{`Segment style: ${style} (click to cycle)`}</title>
              </path>
            </Fragment>
          );
        })}
        {layout.nodes.map((n) => (
          <circle key={n.stationId} cx={laneX(n.lane)} cy={rowY(n.row)} r={DOT_R} fill={color} />
        ))}
      </svg>

      {/* Rows, in graph order, offset past the gutter. */}
      <div style={{ paddingLeft: gutterW + 6 }}>
        {layout.nodes.map((n) => {
          const st = stations[n.stationId];
          if (!st) return null;
          const armed = isAppending && cursorStationId === n.stationId;
          return (
            <div
              key={n.stationId}
              className="list-row"
              style={{ height: ROW_H, gap: 6, alignItems: 'center', padding: '0 8px 0 0' }}
              onMouseEnter={() => onHoverStation(n.stationId)}
              onMouseLeave={() => onHoverStation(null)}
            >
              <span
                className="grow"
                style={{ cursor: 'pointer', fontWeight: isAppending ? 700 : undefined }}
                title="Open station editor"
                onClick={() => onSelectStation(n.stationId)}
              >
                {stationNameListText(st.name)}
              </span>
              {isAppending && (
                <>
                  <button
                    type="button"
                    className="btn-mini icon"
                    onClick={() => onInsertAfter(n.stationId)}
                    title="Insert stops after this stop (in-line)"
                    aria-label={`Insert after ${st.name}`}
                    style={{
                      background: armed && !appendDraw ? color : undefined,
                      color: armed && !appendDraw ? '#fff' : undefined,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>+</span>
                    <ChevronDownIcon />
                  </button>
                  <button
                    type="button"
                    className="btn-mini icon"
                    onClick={() => onBranchFrom(n.stationId)}
                    title="Start a new branch from this stop"
                    aria-label={`Branch from ${st.name}`}
                    style={{
                      background: armed && appendDraw ? color : undefined,
                      color: armed && appendDraw ? '#fff' : undefined,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>+</span>
                    <BranchGlyph />
                  </button>
                  <button
                    type="button"
                    className="btn-mini danger"
                    onClick={() => onRemoveStation(n.stationId)}
                    title="Remove from line"
                    aria-label={`Remove ${st.name} from line`}
                  >
                    <Cross2Icon />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A downward junction glyph (matches the one in LineInspector's insert zones).
function BranchGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 1.5 V13" />
      <path d="M1.8 10.5 L4 13 L6.2 10.5" />
      <path d="M4 5 C 9 5, 11 6.5, 11.2 12" />
      <path d="M9 9.7 L11.2 12.2 L13.2 9.4" />
    </svg>
  );
}
