import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useDoc, useSelection } from '../../state/store';
import { useThemeColors } from '../../state/theme';
import type { DotShape, DotStyle, LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { edgeEndpoints, lineHasEdge } from '../../model/lineTopology';
import { resolveDotStyle } from '../../model/transforms';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { resolveSegmentStyle } from '../../geometry/interlining';
import { ColorPalette } from './ColorPalette';
import { ColorField } from '../ColorField';
import { useFieldHistory } from '../useFieldHistory';
import { useDismiss } from '../usePopover';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';
import { StopGlyph } from '../StopGlyph';
import { StationShapePicker, SHAPES } from '../StationShapePicker';
import { blendOver, legibleTextOn, withAlpha } from '../../util/color';
import { stationNameListText } from '../../geometry/labelTokens';
import { NumericFieldRow } from '../NumericFieldRow';
import { StyleRow } from '../StyleRow';
import {
  LINE_WIDTH_DEFAULT,
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  lineWidthOf,
} from '../../model/lineWidth';
import {
  DOT_SIZE_MAX,
  DOT_SIZE_MIN,
  dotSizeOverride,
  lineDefaultDotSizeOf,
} from '../../model/dotSize';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
  lineStrokeColorOf,
  lineStrokeRailWidth,
  lineStrokeWidthOf,
} from '../../model/lineStroke';
import { stationBandLayout, STATION_ROW_H, GAP_ROW_H } from './stationBandGeometry';
import { StationGraph } from './StationGraph';

// Clear the line editor's pointer-hover highlights (the white dot casing and
// the segment-corridor wash). Call this whenever a hovered row/divider is
// orphaned without an onMouseLeave/onBlur firing — the row is removed or
// reordered out from under the cursor, or the inspector itself unmounts
// (line deleted, a station selected, the panel collapsed). Otherwise the
// highlight dangles on a now-stale stop/segment and re-appears on the canvas
// if the action is undone. Reads the store imperatively so it needs no deps.
function clearInspectorHovers() {
  const s = useSelection.getState();
  s.setHoveredLineStop(null);
  s.setHoveredStation(null);
  s.setHoveredInspectorSegment(null);
}

function DotShapePopover({
  onPick,
  onClose,
  style,
  lineColor,
  serviceCode,
}: {
  onPick: (shape: DotShape) => void;
  onClose: () => void;
  style: React.CSSProperties;
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

const INSERT_ROW_H = 16;
const MARKER_W = 24;

const NEXT_STYLE: Record<LineStyle, LineStyle> = {
  solid: 'dashed',
  dashed: 'hatched',
  hatched: 'hatched-mirror',
  'hatched-mirror': 'dotted',
  dotted: 'dashed-open',
  'dashed-open': 'solid',
};

// A downward junction glyph: a track heading down that also branches off to the
// right, both ending in an arrowhead — the "start a branch here" affordance.
function BranchGlyph() {
  return (
    <svg
      width="14"
      height="14"
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

// One small insert-zone button (the active state fills with the line color).
function ZoneButton({
  active,
  color,
  title,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const tintAlpha = hovered ? 0.6 : 0.4;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-label={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        height: '100%',
        padding: '0 7px',
        margin: 0,
        background: active ? color : withAlpha(color, tintAlpha),
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
        lineHeight: 1,
        color: active ? legibleTextOn(color) : legibleTextOn(blendOver(color, tintAlpha)),
        boxSizing: 'border-box',
      }}
    >
      {children}
    </button>
  );
}

// The insert-zone affordances shown while appending: a left-justified pair of
// small buttons. "Insert after" (+↓) arms the linear insert cursor at this
// position; "Branch" (+ junction) starts a NEW branch drawn from the predecessor
// stop. `canBranch` is false at the very start of the line (no stop to branch
// from).
function InsertZoneButtons({
  color,
  height,
  insertActive,
  branchActive,
  canBranch,
  onInsert,
  onBranch,
  onHoverChange,
}: {
  color: string;
  height: number;
  insertActive: boolean;
  branchActive: boolean;
  canBranch: boolean;
  onInsert: () => void;
  onBranch: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  return (
    <div
      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, height }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <ZoneButton
        active={insertActive}
        color={color}
        title="Insert stops after this stop (in-line)"
        onClick={onInsert}
      >
        <span>+</span>
        <ChevronDownIcon />
      </ZoneButton>
      {canBranch && (
        <ZoneButton
          active={branchActive}
          color={color}
          title="Start a new branch from this stop"
          onClick={onBranch}
        >
          <span>+</span>
          <BranchGlyph />
        </ZoneButton>
      )}
    </div>
  );
}

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const setDotStyle = useDoc((s) => s.setDotStyle);
  const setLineDefaultDotStyle = useDoc((s) => s.setLineDefaultDotStyle);
  const setLineDefaultDotSize = useDoc((s) => s.setLineDefaultDotSize);
  const setLineWidth = useDoc((s) => s.setLineWidth);
  const setLineStrokeWidth = useDoc((s) => s.setLineStrokeWidth);
  const setLineStrokeColor = useDoc((s) => s.setLineStrokeColor);
  const selection = useSelection();
  // Gap color matches the canvas so the band preview mirrors the on-canvas look.
  const underlayColor = useThemeColors().underlay;
  const nameField = useFieldHistory();
  const serviceField = useFieldHistory();
  const [openPickerSid, setOpenPickerSid] = useState<string | null>(null);

  // When this inspector unmounts (line deleted, a station selected, the panel
  // collapsed, or a different line opened), any row/divider hovered at that
  // moment never gets its onMouseLeave — so drop the hovers here.
  useEffect(() => clearInspectorHovers, []);

  if (!line) return null;

  const cycleSegmentStyle = (fromStationId: string, toStationId: string) => {
    const key = pairKeyOf(fromStationId, toStationId);
    const cur = resolveSegmentStyle(line, key);
    setLineSegmentStyle(line.id, fromStationId, toStationId, NEXT_STYLE[cur]);
  };

  const moveSt = (idx: number, dir: -1 | 1) => {
    const arr = [...line.stations];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    // The reordered rows remount under the cursor without an onMouseLeave, so
    // a row/divider hover would dangle on the old position.
    clearInspectorHovers();
    reorderLineStations(line.id, arr);
  };

  const isAppending =
    selection.uiMode.kind === 'appending-to-line' && selection.uiMode.lineId === line.id;
  const appendInsertAfterIndex =
    selection.uiMode.kind === 'appending-to-line' ? selection.uiMode.insertAfterIndex : null;
  const appendDraw =
    selection.uiMode.kind === 'appending-to-line' ? !!selection.uiMode.draw : false;

  return (
    <section className="inspector">
      <div className="field">
        <label>Line name</label>
        <input
          type="text"
          value={line.name}
          onChange={(e) => updateLine(line.id, { name: e.target.value })}
          {...nameField}
        />
      </div>
      <div className="field">
        <label>Service code</label>
        <input
          type="text"
          maxLength={3}
          value={line.service}
          onChange={(e) => updateLine(line.id, { service: e.target.value.toUpperCase() })}
          {...serviceField}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette value={line.color} onChange={(c) => updateLine(line.id, { color: c })} />
      </div>
      {/* Name/service/color above are identity, not style — the style row
          heads the covered formatting controls (dot, width, stroke). */}
      <StyleRow key={line.id} kind="line" itemId={line.id} styleId={line.styleId} />
      <div className="field dot-field">
        <label>Default stop dot type and size</label>
        <NumericFieldRow
          id={`line-dot-size-${line.id}`}
          label="Dot size"
          leading={
            <StationShapePicker
              disabled={false}
              currentStyle={line.defaultDotStyle ?? DEFAULT_DOT_STYLE}
              lineColor={line.color}
              serviceCode={line.service}
              onPick={(shape) => setLineDefaultDotStyle(line.id, DOT_SHAPE_PRESETS[shape])}
            />
          }
          min={DOT_SIZE_MIN}
          max={DOT_SIZE_MAX}
          step={1}
          value={lineDefaultDotSizeOf(line)}
          onChange={(n) => setLineDefaultDotSize(line.id, n)}
          getCurrent={() => lineDefaultDotSizeOf(useDoc.getState().lines[id])}
          textboxAllowAboveMax
        />
      </div>
      <NumericFieldRow
        id={`line-width-${line.id}`}
        label="Line width"
        min={LINE_WIDTH_SLIDER_MIN}
        max={LINE_WIDTH_MAX}
        step={1}
        value={lineWidthOf(line)}
        onChange={(n) => setLineWidth(line.id, n)}
        getCurrent={() => lineWidthOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
        textboxMin={LINE_WIDTH_MIN}
      />
      <NumericFieldRow
        id={`line-stroke-${line.id}`}
        label="Stroke width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={lineStrokeWidthOf(line)}
        onChange={(n) => setLineStrokeWidth(line.id, n)}
        getCurrent={() => lineStrokeWidthOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
      />
      <div className="options-popover-row">
        <label htmlFor={`line-stroke-color-${line.id}`} className="options-popover-label">
          Stroke color
        </label>
        <ColorField
          id={`line-stroke-color-${line.id}`}
          ariaLabel="Stroke color"
          value={lineStrokeColorOf(line)}
          onChange={(c) => setLineStrokeColor(line.id, c)}
        />
      </div>
      <div className="field">
        <button
          type="button"
          onClick={() => {
            if (isAppending) {
              selection.setAppending(null);
            } else {
              selection.setAppending(line.id);
              selection.setInsertAfterIndex(null);
            }
          }}
          title={
            isAppending
              ? 'Done editing. Reorder, remove, or pick stations on the map to add stops.'
              : 'Edit this line: reorder, remove, or add stops.'
          }
          style={{
            width: '100%',
            marginBottom: 3,
            padding: '8px 12px',
            border: 'none',
            borderRadius: 0,
            background: isAppending ? line.color : '#000',
            color: isAppending ? legibleTextOn(line.color) : '#fff',
            fontFamily: 'inherit',
            fontWeight: 500,
            fontSize: 13,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          {isAppending ? 'Done' : 'Edit Stops'}
        </button>
        {/* Not editing: show the column-based graph so branches and loops read
            as their actual shape instead of one flat list. Editing (appending)
            keeps the linear list + insert affordances below. */}
        {line.stations.length > 0 && !isAppending && (
          <StationGraph
            line={line}
            stations={stations}
            color={line.color}
            underlayColor={underlayColor}
            isAppending={false}
            cursorStationId={null}
            appendDraw={false}
            hovered={
              selection.hoveredInspectorSegment?.lineId === line.id
                ? selection.hoveredInspectorSegment
                : null
            }
            onSelectStation={(sid) => selection.selectStation(sid)}
            onRemoveStation={() => {}}
            onCycleSegment={(a, b) => cycleSegmentStyle(a, b)}
            onInsertAfter={() => {}}
            onBranchFrom={() => {}}
            onHoverSegment={(edge) =>
              selection.setHoveredInspectorSegment(
                edge ? { lineId: line.id, fromStationId: edge.from, toStationId: edge.to } : null,
              )
            }
            onHoverStation={(sid) => {
              if (sid) {
                selection.setHoveredLineStop({ lineId: line.id, stationId: sid });
                selection.setHoveredStation(sid);
              } else {
                selection.setHoveredLineStop(null);
                selection.setHoveredStation(null);
              }
            }}
          />
        )}
        {line.stations.length > 0 &&
          isAppending &&
          (() => {
            const N = line.stations.length;
            // The preview band always paints at the default line width — the
            // actual width would render thin lines as near-invisible hairlines
            // here, and the band is only a style affordance, not a width gauge.
            const previewW = LINE_WIDTH_DEFAULT;
            const {
              totalHeight: totalBandH,
              centerOf,
              segments,
            } = stationBandLayout(line, stations, previewW);
            const needsHatchDefs = segments.some(
              (s) => s.style === 'hatched' || s.style === 'hatched-mirror',
            );
            const hovered = selection.hoveredInspectorSegment;
            const isActiveAt = (idx: number) => isAppending && appendInsertAfterIndex === idx;
            const insertActiveAt = (idx: number) => isActiveAt(idx) && !appendDraw;
            const branchActiveAt = (idx: number) => isActiveAt(idx) && appendDraw;
            // Insert button arms the linear cursor (draw off); branch button arms
            // draw mode with the pen on the predecessor stop.
            const moveCursor = (idx: number) => selection.setInsertAfterIndex(idx, false);
            const branchAt = (idx: number) => selection.setInsertAfterIndex(idx, true);
            const hoverPredecessor = (predSid: string | null) => (h: boolean) => {
              if (h && predSid) {
                selection.setHoveredLineStop({ lineId: line.id, stationId: predSid });
                selection.setHoveredStation(predSid);
              } else {
                selection.setHoveredLineStop(null);
                selection.setHoveredStation(null);
              }
            };
            return (
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
                <svg
                  width={MARKER_W}
                  height={totalBandH}
                  style={{
                    position: 'absolute',
                    top: INSERT_ROW_H,
                    left: 0,
                    pointerEvents: 'none',
                  }}
                >
                  {needsHatchDefs && (
                    <defs>
                      <HatchPatterns colors={[line.color]} underlayColor={underlayColor} />
                    </defs>
                  )}
                  {segments.map((seg) => {
                    const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
                      seg.style,
                      line.color,
                      previewW,
                    );
                    const underlay = lineStyleUnderlayAttrs(seg.style, underlayColor);
                    const isHovered =
                      hovered?.lineId === line.id &&
                      hovered?.fromStationId === seg.sid &&
                      hovered?.toStationId === seg.nextSid;
                    const filter = isHovered ? 'brightness(1.4) saturate(1.2)' : undefined;
                    // Casing rails in the preview band, mirroring the
                    // canvas: two lines centered on the body's edges.
                    const previewRailW = lineStrokeRailWidth(lineStrokeWidthOf(line), previewW);
                    return (
                      <Fragment key={seg.i}>
                        {underlay && (
                          <line
                            x1={MARKER_W / 2}
                            y1={seg.y1}
                            x2={MARKER_W / 2}
                            y2={seg.y2}
                            stroke={underlay.stroke}
                            strokeWidth={previewW}
                            strokeLinecap="butt"
                            style={filter ? { filter } : undefined}
                          />
                        )}
                        <line
                          x1={MARKER_W / 2}
                          y1={seg.y1}
                          x2={MARKER_W / 2}
                          y2={seg.y2}
                          stroke={stroke}
                          strokeWidth={previewW}
                          strokeLinecap={strokeLinecap}
                          strokeDasharray={strokeDasharray}
                          style={filter ? { filter } : undefined}
                        />
                        {previewRailW > 0 &&
                          [-1, 1].map((side) => (
                            <line
                              key={side}
                              data-preview-casing
                              x1={MARKER_W / 2 + (side * previewW) / 2}
                              y1={seg.y1}
                              x2={MARKER_W / 2 + (side * previewW) / 2}
                              y2={seg.y2}
                              stroke={lineStrokeColorOf(line)}
                              strokeWidth={previewRailW}
                              strokeLinecap="butt"
                              style={filter ? { filter } : undefined}
                            />
                          ))}
                      </Fragment>
                    );
                  })}
                  {line.stations.map((sid, i) => {
                    const station = stations[sid];
                    if (!station) return null;
                    const stop = station.stops.find((s) => s.lineId === line.id);
                    const style: DotStyle = resolveDotStyle(line, stop);
                    return (
                      <g
                        key={i + ':' + sid}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenPickerSid((cur) => (cur === sid ? null : sid));
                        }}
                      >
                        <circle
                          cx={MARKER_W / 2}
                          cy={centerOf(i)}
                          r={7}
                          fill="transparent"
                          style={{ pointerEvents: 'visible' }}
                        />
                        <StopGlyph
                          cx={MARKER_W / 2}
                          cy={centerOf(i)}
                          style={style}
                          lineColor={line.color}
                          serviceCode={line.service}
                          sizeOverride={dotSizeOverride(line, stop)}
                        />
                      </g>
                    );
                  })}
                </svg>
                {openPickerSid !== null &&
                  (() => {
                    const idx = line.stations.indexOf(openPickerSid);
                    if (idx < 0) return null;
                    return (
                      <DotShapePopover
                        lineColor={line.color}
                        serviceCode={line.service}
                        onPick={(shape) => {
                          setDotStyle(openPickerSid, line.id, DOT_SHAPE_PRESETS[shape]);
                          setOpenPickerSid(null);
                        }}
                        onClose={() => setOpenPickerSid(null)}
                        style={{
                          position: 'absolute',
                          top: INSERT_ROW_H + centerOf(idx) + 10,
                          left: MARKER_W + 4,
                        }}
                      />
                    );
                  })()}
                <div style={{ display: 'flex', height: INSERT_ROW_H }}>
                  <div style={{ width: MARKER_W, flexShrink: 0 }} />
                  {isAppending && (
                    <InsertZoneButtons
                      color={line.color}
                      height={INSERT_ROW_H}
                      insertActive={insertActiveAt(-1)}
                      branchActive={false}
                      canBranch={false}
                      onInsert={() => moveCursor(-1)}
                      onBranch={() => {}}
                    />
                  )}
                </div>
                {line.stations.map((sid, i) => {
                  const st = stations[sid];
                  if (!st) return null;
                  const isLast = i === N - 1;
                  return (
                    <Fragment key={i + ':' + sid}>
                      <div
                        className="list-row"
                        style={{
                          padding: '0 12px 0 0',
                          gap: 0,
                          height: STATION_ROW_H,
                          boxSizing: 'border-box',
                        }}
                        onMouseEnter={() => {
                          selection.setHoveredLineStop({ lineId: line.id, stationId: sid });
                          selection.setHoveredStation(sid);
                        }}
                        onMouseLeave={() => {
                          selection.setHoveredLineStop(null);
                          selection.setHoveredStation(null);
                        }}
                      >
                        <div style={{ width: MARKER_W, flexShrink: 0 }} />
                        <span
                          className="grow"
                          style={{
                            paddingLeft: 8,
                            cursor: 'pointer',
                            fontWeight: isAppending ? 700 : undefined,
                          }}
                          title="Open station editor"
                          onClick={() => selection.selectStation(sid)}
                        >
                          {stationNameListText(st.name)}
                        </span>
                        {isAppending && (
                          <>
                            <button
                              className="btn-mini icon"
                              disabled={i === 0}
                              onClick={() => moveSt(i, -1)}
                              title="Move up"
                              aria-label="Move up"
                              style={{ marginLeft: 6 }}
                            >
                              <ChevronUpIcon />
                            </button>
                            <button
                              className="btn-mini icon"
                              disabled={i === N - 1}
                              onClick={() => moveSt(i, 1)}
                              title="Move down"
                              aria-label="Move down"
                              style={{ marginLeft: 6 }}
                            >
                              <ChevronDownIcon />
                            </button>
                            <button
                              className="btn-mini danger"
                              onClick={() => {
                                // The row (and the dividers of the segments it
                                // bordered) unmount on removal without firing
                                // onMouseLeave, so clear their hover highlights.
                                clearInspectorHovers();
                                removeStationFromLine(line.id, i);
                              }}
                              title="Remove from line"
                              aria-label="Remove from line"
                              style={{ marginLeft: 6 }}
                            >
                              <Cross2Icon />
                            </button>
                          </>
                        )}
                      </div>
                      {!isLast &&
                        (() => {
                          const nextSid = line.stations[i + 1];
                          if (!stations[nextSid]) return null;
                          const key = pairKeyOf(sid, nextSid);
                          const segStyle = resolveSegmentStyle(line, key);
                          const setHover = () =>
                            selection.setHoveredInspectorSegment({
                              lineId: line.id,
                              fromStationId: sid,
                              toStationId: nextSid,
                            });
                          const clearHover = () => selection.setHoveredInspectorSegment(null);
                          // The divider is a transparent hit-target over the
                          // preview band's segment, so it's only meaningful when
                          // this consecutive-display pair is a REAL edge. After a
                          // reorder or on a branch, adjacent rows may not be an
                          // edge — off-chain edges (branch legs, loop wraps) are
                          // styled via the "Branch / loop segments" list below.
                          const isEdge = lineHasEdge(line, sid, nextSid);
                          return (
                            <div style={{ display: 'flex', height: GAP_ROW_H }}>
                              {isEdge ? (
                                <button
                                  type="button"
                                  onClick={() => cycleSegmentStyle(sid, nextSid)}
                                  onMouseEnter={setHover}
                                  onMouseLeave={clearHover}
                                  onFocus={setHover}
                                  onBlur={clearHover}
                                  data-segment-style-divider
                                  data-style={segStyle}
                                  title={`Segment style: ${segStyle} (click to cycle)`}
                                  aria-label={`Segment style: ${segStyle} (click to cycle)`}
                                  style={{
                                    width: MARKER_W,
                                    height: GAP_ROW_H,
                                    flexShrink: 0,
                                    padding: 0,
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                  }}
                                />
                              ) : (
                                <div style={{ width: MARKER_W, flexShrink: 0 }} />
                              )}
                              {isAppending && (
                                <InsertZoneButtons
                                  color={line.color}
                                  height={GAP_ROW_H}
                                  insertActive={insertActiveAt(i)}
                                  branchActive={branchActiveAt(i)}
                                  canBranch
                                  onInsert={() => moveCursor(i)}
                                  onBranch={() => branchAt(i)}
                                  onHoverChange={hoverPredecessor(sid)}
                                />
                              )}
                            </div>
                          );
                        })()}
                    </Fragment>
                  );
                })}
                <div style={{ display: 'flex', height: INSERT_ROW_H }}>
                  <div style={{ width: MARKER_W, flexShrink: 0 }} />
                  {isAppending && (
                    <InsertZoneButtons
                      color={line.color}
                      height={INSERT_ROW_H}
                      insertActive={insertActiveAt(N - 1)}
                      branchActive={branchActiveAt(N - 1)}
                      canBranch
                      onInsert={() => moveCursor(N - 1)}
                      onBranch={() => branchAt(N - 1)}
                      onHoverChange={hoverPredecessor(line.stations[N - 1])}
                    />
                  )}
                </div>
              </div>
            );
          })()}
        {/* While editing, edges the linear preview band can't show — loop-closing
            wraps and branch legs (any edge not between two display-consecutive
            stops). When not editing, the graph's connectors are clickable
            instead, so this only appears in append mode. */}
        {isAppending &&
          (() => {
            const consecutive = new Set<string>();
            for (let i = 0; i < line.stations.length - 1; i++) {
              consecutive.add(pairKeyOf(line.stations[i], line.stations[i + 1]));
            }
            const extras = line.edges.filter((e) => !consecutive.has(e));
            if (extras.length === 0) return null;
            return (
              <div className="field">
                <label>Branch / loop segments</label>
                {extras.map((e) => {
                  const [a, b] = edgeEndpoints(e);
                  const sa = stations[a];
                  const sb = stations[b];
                  if (!sa || !sb) return null;
                  const segStyle = resolveSegmentStyle(line, e);
                  const setHover = () =>
                    selection.setHoveredInspectorSegment({
                      lineId: line.id,
                      fromStationId: a,
                      toStationId: b,
                    });
                  const clearHover = () => selection.setHoveredInspectorSegment(null);
                  return (
                    <div
                      key={e}
                      className="list-row"
                      style={{ gap: 8, alignItems: 'center', padding: '2px 0' }}
                      onMouseEnter={setHover}
                      onMouseLeave={clearHover}
                    >
                      <span className="grow" style={{ paddingLeft: 4 }}>
                        {stationNameListText(sa.name)} → {stationNameListText(sb.name)}
                      </span>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => cycleSegmentStyle(a, b)}
                        onFocus={setHover}
                        onBlur={clearHover}
                        title={`Segment style: ${segStyle} (click to cycle)`}
                        aria-label={`Segment style ${sa.name} to ${sb.name}: ${segStyle} (click to cycle)`}
                        style={{ minWidth: 72, textTransform: 'capitalize' }}
                      >
                        {segStyle}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        {/* An empty line has no station band, so surface the same
            "before the first stop" insert lozenge on its own. Clicking it
            arms the cursor (-1) so map clicks add the first stop — identical
            to the populated-line flow. */}
        {isAppending && line.stations.length === 0 && (
          <div style={{ display: 'flex', height: INSERT_ROW_H }}>
            <div style={{ width: MARKER_W, flexShrink: 0 }} />
            <InsertZoneButtons
              color={line.color}
              height={INSERT_ROW_H}
              insertActive={appendInsertAfterIndex === -1 && !appendDraw}
              branchActive={false}
              canBranch={false}
              onInsert={() => selection.setInsertAfterIndex(-1, false)}
              onBranch={() => {}}
            />
          </div>
        )}
      </div>
    </section>
  );
}
