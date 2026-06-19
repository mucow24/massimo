import { Fragment, useMemo, useRef, useState } from 'react';
import { useDoc, useSelection } from '../../state/store';
import { useThemeColors } from '../../state/theme';
import type { DotShape, DotStyle, Line, LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotStyle } from '../../model/transforms';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { resolveSegmentStyle } from '../../geometry/interlining';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';
import { useDismiss } from '../usePopover';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';
import { StopGlyph } from '../StopGlyph';
import { StationShapePicker, SHAPES } from '../StationShapePicker';
import { blendOver, legibleTextOn, withAlpha } from '../../util/color';
import { InlineBulletText } from '../InlineBulletText';
import { NumericFieldRow } from '../NumericFieldRow';
import {
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
import {
  stationBandLayout,
  STATION_ROW_H,
  GAP_ROW_H,
  PREVIEW_W_MIN,
  PREVIEW_W_MAX,
} from './stationBandGeometry';

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

function InsertZone({
  isActive,
  color,
  height,
  onClick,
  onHoverChange,
}: {
  isActive: boolean;
  color: string;
  height: number;
  onClick: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const tintAlpha = hovered ? 0.6 : 0.4;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        setHovered(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverChange?.(false);
      }}
      title={
        isActive
          ? 'Stops will be inserted here. Click to stop adding.'
          : 'Click to insert stops here'
      }
      style={{
        flex: 1,
        height,
        padding: '0 8px',
        margin: 0,
        background: isActive ? color : withAlpha(color, tintAlpha),
        border: 'none',
        borderRadius: height / 2,
        textAlign: 'center',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        color: isActive ? legibleTextOn(color) : legibleTextOn(blendOver(color, tintAlpha)),
        boxSizing: 'border-box',
      }}
    >
      +
    </button>
  );
}

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const allLines = useDoc((s) => s.lines);
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
  const strokeColorField = useFieldHistory();
  const [openPickerSid, setOpenPickerSid] = useState<string | null>(null);
  // Service-code → line lookup for inline `<CODE>` bullets in station names.
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(allLines)) map.set(ln.service, ln);
    return map;
  }, [allLines]);

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
    reorderLineStations(line.id, arr);
  };

  const isAppending =
    selection.uiMode.kind === 'appending-to-line' && selection.uiMode.lineId === line.id;
  const appendInsertAfterIndex =
    selection.uiMode.kind === 'appending-to-line' ? selection.uiMode.insertAfterIndex : null;

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
        <label>Default stop dot</label>
        <StationShapePicker
          disabled={false}
          currentStyle={line.defaultDotStyle ?? DEFAULT_DOT_STYLE}
          lineColor={line.color}
          serviceCode={line.service}
          onPick={(shape) => setLineDefaultDotStyle(line.id, DOT_SHAPE_PRESETS[shape])}
        />
      </div>
      <NumericFieldRow
        id={`line-dot-size-${line.id}`}
        label="Dot size"
        min={DOT_SIZE_MIN}
        max={DOT_SIZE_MAX}
        step={1}
        value={lineDefaultDotSizeOf(line)}
        onChange={(n) => setLineDefaultDotSize(line.id, n)}
        getCurrent={() => lineDefaultDotSizeOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
      />
      <div className="field">
        <label>Color</label>
        <ColorPalette value={line.color} onChange={(c) => updateLine(line.id, { color: c })} />
      </div>
      <NumericFieldRow
        id={`line-width-${line.id}`}
        label="Width"
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
        label="Stroke"
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
        <input
          id={`line-stroke-color-${line.id}`}
          type="color"
          aria-label="Stroke color"
          value={lineStrokeColorOf(line)}
          onChange={(e) => setLineStrokeColor(line.id, e.target.value)}
          {...strokeColorField}
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
        {line.stations.length > 0 &&
          (() => {
            const N = line.stations.length;
            // Preview the line's actual width, clamped so the band stays
            // inside the fixed marker column.
            const previewW = Math.min(Math.max(lineWidthOf(line), PREVIEW_W_MIN), PREVIEW_W_MAX);
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
            const moveCursor = (idx: number) => selection.setInsertAfterIndex(idx);
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
                    <InsertZone
                      isActive={isActiveAt(-1)}
                      color={line.color}
                      height={INSERT_ROW_H}
                      onClick={() => moveCursor(-1)}
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
                          <InlineBulletText text={st.name} lineByService={lineByService} />
                        </span>
                        {isAppending && (
                          <>
                            <button
                              className="btn-mini icon"
                              disabled={i === 0}
                              onClick={() => moveSt(i, -1)}
                              title="Move up"
                              style={{ marginLeft: 6 }}
                            >
                              ↑
                            </button>
                            <button
                              className="btn-mini icon"
                              disabled={i === N - 1}
                              onClick={() => moveSt(i, 1)}
                              title="Move down"
                              style={{ marginLeft: 6 }}
                            >
                              ↓
                            </button>
                            <button
                              className="btn-mini danger"
                              onClick={() => removeStationFromLine(line.id, i)}
                              title="Remove from line"
                              style={{ marginLeft: 6 }}
                            >
                              ×
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
                          return (
                            <div style={{ display: 'flex', height: GAP_ROW_H }}>
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
                              {isAppending && (
                                <InsertZone
                                  isActive={isActiveAt(i)}
                                  color={line.color}
                                  height={GAP_ROW_H}
                                  onClick={() => moveCursor(i)}
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
                    <InsertZone
                      isActive={isActiveAt(N - 1)}
                      color={line.color}
                      height={INSERT_ROW_H}
                      onClick={() => moveCursor(N - 1)}
                      onHoverChange={hoverPredecessor(line.stations[N - 1])}
                    />
                  )}
                </div>
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
            <InsertZone
              isActive={appendInsertAfterIndex === -1}
              color={line.color}
              height={INSERT_ROW_H}
              onClick={() => selection.setInsertAfterIndex(-1)}
            />
          </div>
        )}
      </div>
    </section>
  );
}
