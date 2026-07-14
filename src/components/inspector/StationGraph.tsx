import { Fragment, useRef, useState, type CSSProperties } from 'react';
import type { DotShape, DotStyle, Line, Station, StationId } from '../../model/types';
import { lineGraphLayout } from './lineGraphLayout';
import { edgeEndpoints, degreeOf } from '../../model/lineTopology';
import { openPolylinePath, type Pt } from '../../geometry/polygonUnion';
import { resolveSegmentStyle } from '../../geometry/interlining';
import { resolveDotStyle } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs, HatchPatterns } from '../HatchPatterns';
import { StopGlyph } from '../StopGlyph';
import { BranchGlyph } from './BranchGlyph';
import { SHAPES } from '../StationShapePicker';
import { useDismiss } from '../usePopover';
import { stationNameListText } from '../../geometry/labelTokens';
import { ChevronDownIcon, Cross2Icon } from '@radix-ui/react-icons';

// A column-based ("git graph") rendering of a line's stops in the inspector:
// the trunk runs down lane 0, a branch tees into a side lane directly under
// its junction, a cycle arm rejoins the line as a merge (the tee's mirror),
// and other loop closures bow out in a reused side lane. Each stop is a row
// (name + controls); the colored connectors between stops are clickable to
// cycle that segment's style. Replaces the old flat band so a branchy/looped
// line reads as its actual shape instead of one confusing list.

const LANE_W = 24;
const ROW_H = 26;
const DOT_D = 12; // stop dot DIAMETER in the graph (1px larger than the old r=5 circle)
const BODY_W = 7; // route-line stroke width for the connectors
// Constant radius for every 90° corner. Must exceed the stroke width so the bend
// reads as a curve (a railway-junction sweep), not a hard corner; and stay ≤
// LANE_W/2 and ≤ ROW_H/2 so a corner never overshoots its shortest segment.
const CORNER_R = 11;

// x-center of a lane within the gutter, MIRRORED so lane 0 (the trunk) renders at
// the RIGHTMOST position — nearest the name column just past the gutter's right
// edge — and each further lane (branches, loop side-lanes) steps left, away from
// the text. Keeps a line's main run of stops tight against their names.
export const laneCenterX = (lane: number, laneCount: number) =>
  (laneCount - 1 - lane) * LANE_W + LANE_W / 2;
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
  // Delete this track segment (right-click a connector). How a loop or branch
  // edge is removed without deleting either stop.
  onRemoveSegment: (a: StationId, b: StationId) => void;
  // Set a stop's dot style (from clicking its dot in the editor). No-op when the
  // graph is read-only (not appending).
  onSetDotStyle: (sid: StationId, style: DotStyle) => void;
  onInsertAfter: (sid: StationId) => void;
  onBranchFrom: (sid: StationId) => void;
  onHoverSegment: (edge: { from: StationId; to: StationId } | null) => void;
  onHoverStation: (sid: StationId | null) => void;
}

// Connector from the upper endpoint down to the lower one, as orthogonal
// segments with constant rounded corners. Takes resolved pixel coordinates so
// the caller owns lane→x (and its mirror). Same lane → a plain vertical.
// Cross-lane, the path runs straight down to `yTee`, jogs across in that blank
// row, then drops to the lower endpoint — `yTee` is the blank one cell below
// the parent for a branch tee, and the blank one cell above the target for a
// merge, so the horizontal never crosses a stop's dot.
function treePath(x1: number, y1: number, x2: number, y2: number, yTee: number): string {
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`;
  const pts: Pt[] = [
    { x: x1, y: y1 },
    { x: x1, y: yTee },
    { x: x2, y: yTee },
    { x: x2, y: y2 },
  ];
  return openPolylinePath(pts, CORNER_R);
}

// A loop back-edge, drawn so its horizontals sit in blank rows clear of the stops:
// from the upper stop go to its blank row (ABOVE it — the arc comes over the top)
// and tee off into the side lane, run straight down, reach the lower stop's blank
// row (below it), jog back to the trunk, and rise into the lower stop. Takes
// resolved coordinates (`uyB`/`lyB` are the blank-row y's) so the caller owns the
// lane→x mirror.
function loopPath(
  ux: number,
  uy: number,
  lx: number,
  ly: number,
  sx: number,
  uyB: number,
  lyB: number,
): string {
  const pts: Pt[] = [
    { x: ux, y: uy },
    { x: ux, y: uyB },
    { x: sx, y: uyB },
    { x: sx, y: lyB },
    { x: lx, y: lyB },
    { x: lx, y: ly },
  ];
  return openPolylinePath(pts, CORNER_R);
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
    onRemoveSegment,
    onSetDotStyle,
    onInsertAfter,
    onBranchFrom,
    onHoverSegment,
    onHoverStation,
  } = props;
  // Which stop's dot picker is open (editor only).
  const [pickerSid, setPickerSid] = useState<StationId | null>(null);

  const layout = lineGraphLayout(line);
  const laneX = (lane: number) => laneCenterX(lane, layout.laneCount);
  const gutterW = layout.laneCount * LANE_W;
  const totalH = layout.rowCount * ROW_H;
  const nodeByRow = new Map(layout.nodes.map((n) => [n.row, n]));
  const pickedNode = pickerSid ? layout.nodes.find((n) => n.stationId === pickerSid) : null;
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
          const na = stations[a]?.name ?? a;
          const nb = stations[b]?.name ?? b;
          const style = resolveSegmentStyle(line, e.pairKey);
          const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
            style,
            color,
            BODY_W,
          );
          const underlay = lineStyleUnderlayAttrs(style, underlayColor);
          const d =
            e.kind === 'loop'
              ? loopPath(
                  laneX(e.fromLane),
                  rowY(e.fromRow),
                  laneX(e.toLane),
                  rowY(e.toRow),
                  laneX(e.sideLane ?? layout.laneCount),
                  rowY(e.upperBlank ?? e.fromRow),
                  rowY(e.lowerBlank ?? e.toRow),
                )
              : treePath(
                  laneX(e.fromLane),
                  rowY(e.fromRow),
                  laneX(e.toLane),
                  rowY(e.toRow),
                  // A branch tees off just below its parent; a merge jogs into
                  // its target from the blank row just above it.
                  rowY(e.kind === 'merge' ? (e.jogRow ?? e.toRow) : (e.teeRow ?? e.fromRow)),
                );
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
                data-segment-connector
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(BODY_W + 8, 14)}
                style={{ cursor: 'pointer' }}
                onClick={() => onCycleSegment(a, b)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onRemoveSegment(a, b);
                }}
                onMouseEnter={() => onHoverSegment({ from: a, to: b })}
                onMouseLeave={() => onHoverSegment(null)}
              >
                <title>{`Segment ${na} → ${nb}: ${style} (left-click to cycle style, right-click to remove)`}</title>
              </path>
            </Fragment>
          );
        })}
        {layout.nodes.map((n) => {
          const cell = stations[n.stationId]?.stops.find((c) => c.lineId === line.id);
          const cx = laneX(n.lane);
          const cy = rowY(n.row);
          return (
            <Fragment key={n.stationId}>
              {/* The stop's ACTUAL dot type (shape/fill/stroke), at a fixed
                  graph size. */}
              <StopGlyph
                cx={cx}
                cy={cy}
                style={cell ? resolveDotStyle(line, cell) : undefined}
                lineColor={color}
                serviceCode={line.service}
                sizeOverride={DOT_D}
              />
              {/* Editor: click the dot to change its type. */}
              {isAppending && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={DOT_D / 2 + 3}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setPickerSid(n.stationId)}
                >
                  <title>Change stop dot type</title>
                </circle>
              )}
            </Fragment>
          );
        })}
      </svg>
      {pickedNode && (
        <DotShapePopover
          lineColor={color}
          serviceCode={line.service}
          style={{
            position: 'absolute',
            top: rowY(pickedNode.row) + DOT_D / 2 + 4,
            left: laneX(pickedNode.lane) + 6,
            zIndex: 10,
          }}
          onPick={(shape) => {
            onSetDotStyle(pickedNode.stationId, DOT_SHAPE_PRESETS[shape]);
            setPickerSid(null);
          }}
          onClose={() => setPickerSid(null)}
        />
      )}

      {/* Rows, one per grid row, offset past the gutter. Blank T-junction rows
          render an empty spacer so the list stays aligned with the gutter. */}
      <div style={{ paddingLeft: gutterW + 6 }}>
        {Array.from({ length: layout.rowCount }, (_, row) => {
          const n = nodeByRow.get(row);
          if (!n || !stations[n.stationId])
            return <div key={`blank-${row}`} style={{ height: ROW_H }} />;
          const st = stations[n.stationId]!;
          const armed = isAppending && cursorStationId === n.stationId;
          // Branch only forks a NEW arm on a stop that already has ≥2 edges. On a
          // terminal (degree ≤ 1) "branch" would just extend the line, identical
          // to Insert after — so we hide the button there. It's kept in the DOM
          // (visibility, not unmounted) so its slot stays reserved and the
          // Insert/Remove columns don't go ragged from row to row.
          const canBranch = degreeOf(line, n.stationId) >= 2;
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
                    title={
                      armed && !appendDraw
                        ? 'Click to stop adding after this stop'
                        : 'Insert stops after this stop (in-line)'
                    }
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
                    onClick={canBranch ? () => onBranchFrom(n.stationId) : undefined}
                    title={
                      armed && appendDraw
                        ? 'Click to stop branching from this stop'
                        : 'Start a new branch from this stop'
                    }
                    aria-label={`Branch from ${st.name}`}
                    aria-hidden={!canBranch}
                    tabIndex={canBranch ? undefined : -1}
                    style={{
                      visibility: canBranch ? undefined : 'hidden',
                      background: armed && appendDraw ? color : undefined,
                      color: armed && appendDraw ? '#fff' : undefined,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>+</span>
                    <BranchGlyph size={13} />
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

// The stop-dot shape picker, opened by clicking a dot in the editor. Restored
// from the old flat list; positioned by the caller next to the clicked dot.
function DotShapePopover({
  onPick,
  onClose,
  style,
  lineColor,
  serviceCode,
}: {
  onPick: (shape: DotShape) => void;
  onClose: () => void;
  style: CSSProperties;
  lineColor: string;
  serviceCode: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(true, onClose, [ref]);
  return (
    <div className="shape-grid" role="menu" ref={ref} style={{ ...style, right: 'auto' }}>
      {SHAPES.map(({ shape, label }) => (
        <button
          key={shape}
          type="button"
          role="menuitem"
          className="shape-option"
          aria-label={label}
          onClick={() => onPick(shape)}
        >
          <svg width={20} height={20} viewBox="-10 -10 20 20">
            <StopGlyph
              cx={0}
              cy={0}
              style={DOT_SHAPE_PRESETS[shape]}
              lineColor={lineColor}
              serviceCode={serviceCode}
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
