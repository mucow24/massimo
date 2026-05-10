import { Fragment, useEffect, useRef, useState } from 'react';
import { useDoc, useSelection } from '../../state/store';
import type { DotShape, LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';
import { StopGlyph } from '../StopGlyph';
import { blendOver, legibleTextOn, withAlpha } from '../../util/color';

const DOT_SHAPES: Array<{ shape: DotShape; label: string }> = [
  { shape: 'filled-black', label: 'Filled black' },
  { shape: 'open-black', label: 'Open black' },
  { shape: 'filled-black-white-stroke', label: 'Filled black with white stroke' },
  { shape: 'filled-white', label: 'Filled white' },
  { shape: 'open-white', label: 'Open white' },
  { shape: 'filled-white-black-stroke', label: 'Filled white with black stroke' },
  { shape: 'filled-black-diamond', label: 'Filled black diamond' },
  { shape: 'filled-white-diamond', label: 'Filled white diamond' },
  { shape: 'none', label: 'None' },
];

function DotShapePopover({
  onPick,
  onClose,
  style,
}: {
  onPick: (shape: DotShape) => void;
  onClose: () => void;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      className="shape-grid"
      role="menu"
      ref={ref}
      style={{ ...style, right: 'auto' }}
    >
      {DOT_SHAPES.map(({ shape, label }) => (
        <button
          key={shape}
          type="button"
          role="menuitem"
          className="shape-option"
          aria-label={label}
          onClick={() => onPick(shape)}
        >
          <svg width={20} height={20} viewBox="-10 -10 20 20">
            <StopGlyph cx={0} cy={0} shape={shape} />
          </svg>
        </button>
      ))}
    </div>
  );
}

const STATION_ROW_H = 20;
const GAP_ROW_H = 16;
const INSERT_ROW_H = 16;
const BAND_W = 14;
const MARKER_W = 24;

const NEXT_STYLE: Record<LineStyle, LineStyle> = {
  solid: 'dashed',
  dashed: 'hatched',
  hatched: 'hatched-mirror',
  'hatched-mirror': 'solid',
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
  const updateLine = useDoc((s) => s.updateLine);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const setDotShape = useDoc((s) => s.setDotShape);
  const selection = useSelection();
  const serviceField = useFieldHistory();
  const [openPickerSid, setOpenPickerSid] = useState<string | null>(null);

  if (!line) return null;

  const cycleSegmentStyle = (fromStationId: string, toStationId: string) => {
    const key = pairKeyOf(fromStationId, toStationId);
    const cur = (line.segmentStyles?.[key] ?? 'solid') as LineStyle;
    setLineSegmentStyle(line.id, fromStationId, toStationId, NEXT_STYLE[cur]);
  };

  const moveSt = (idx: number, dir: -1 | 1) => {
    const arr = [...line.stations];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderLineStations(line.id, arr);
  };

  const isAppending = selection.appendingToLineId === line.id;

  return (
    <section className="inspector">
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
      <div className="field">
        <label>Stations ({line.stations.length})</label>
        <button
          className="btn-mini"
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
            ...(isAppending
              ? {
                  background: line.color,
                  color: legibleTextOn(line.color),
                  borderColor: line.color,
                }
              : {}),
          }}
        >
          {isAppending ? 'Done' : 'Edit stops'}
        </button>
        {line.stations.length > 0 &&
          (() => {
            const N = line.stations.length;
            const totalBandH = N * STATION_ROW_H + Math.max(0, N - 1) * GAP_ROW_H;
            const cap = BAND_W / 2;
            const centerOf = (idx: number) =>
              idx * (STATION_ROW_H + GAP_ROW_H) + STATION_ROW_H / 2;
            const segments: Array<{
              i: number;
              sid: string;
              nextSid: string;
              style: LineStyle;
              y1: number;
              y2: number;
            }> = [];
            for (let i = 0; i < N - 1; i++) {
              const sid = line.stations[i];
              const nextSid = line.stations[i + 1];
              if (!stations[sid] || !stations[nextSid]) continue;
              const key = pairKeyOf(sid, nextSid);
              const style = (line.segmentStyles?.[key] ?? 'solid') as LineStyle;
              const y1 = i === 0 ? centerOf(0) - cap : centerOf(i);
              const y2 = i === N - 2 ? centerOf(N - 1) + cap : centerOf(i + 1);
              segments.push({ i, sid, nextSid, style, y1, y2 });
            }
            const needsHatchDefs = segments.some(
              (s) => s.style === 'hatched' || s.style === 'hatched-mirror',
            );
            const hovered = selection.hoveredInspectorSegment;
            const isActiveAt = (idx: number) =>
              isAppending && selection.insertAfterIndex === idx;
            const moveCursor = (idx: number) => selection.setInsertAfterIndex(idx);
            const hoverPredecessor =
              (predSid: string | null) => (h: boolean) => {
                if (h && predSid) {
                  selection.setHoveredLineStop({ lineId: line.id, stationId: predSid });
                  selection.setHoveredStation(predSid);
                } else {
                  selection.setHoveredLineStop(null);
                  selection.setHoveredStation(null);
                }
              };
            return (
              <div
                style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
              >
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
                      <HatchPatterns colors={[line.color]} />
                    </defs>
                  )}
                  {segments.map((seg) => {
                    const { stroke, strokeDasharray } = lineStyleStrokeAttrs(
                      seg.style,
                      line.color,
                    );
                    const underlay = lineStyleUnderlayAttrs(seg.style);
                    const isHovered =
                      hovered?.lineId === line.id &&
                      hovered?.fromStationId === seg.sid &&
                      hovered?.toStationId === seg.nextSid;
                    const filter = isHovered ? 'brightness(1.4) saturate(1.2)' : undefined;
                    return (
                      <Fragment key={seg.i}>
                        {underlay && (
                          <line
                            x1={MARKER_W / 2}
                            y1={seg.y1}
                            x2={MARKER_W / 2}
                            y2={seg.y2}
                            stroke={underlay.stroke}
                            strokeWidth={BAND_W}
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
                          strokeWidth={BAND_W}
                          strokeLinecap="butt"
                          strokeDasharray={strokeDasharray}
                          style={filter ? { filter } : undefined}
                        />
                      </Fragment>
                    );
                  })}
                  {line.stations.map((sid, i) => {
                    const station = stations[sid];
                    if (!station) return null;
                    const stop = station.stops.find((s) => s.lineId === line.id);
                    const shape: DotShape = stop?.dotShape ?? 'filled-black';
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
                        <StopGlyph cx={MARKER_W / 2} cy={centerOf(i)} shape={shape} />
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
                        onPick={(shape) => {
                          setDotShape(openPickerSid, line.id, shape);
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
                          {st.name}
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
                          const segStyle = (line.segmentStyles?.[key] ?? 'solid') as LineStyle;
                          const setHover = () =>
                            selection.setHoveredInspectorSegment({
                              lineId: line.id,
                              fromStationId: sid,
                              toStationId: nextSid,
                            });
                          const clearHover = () =>
                            selection.setHoveredInspectorSegment(null);
                          return (
                            <div style={{ display: 'flex', height: GAP_ROW_H }}>
                              <button
                                type="button"
                                onClick={() => cycleSegmentStyle(sid, nextSid)}
                                onMouseEnter={setHover}
                                onMouseLeave={clearHover}
                                onFocus={setHover}
                                onBlur={clearHover}
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
                {isAppending && (
                  <div style={{ display: 'flex', height: INSERT_ROW_H }}>
                    <div style={{ width: MARKER_W, flexShrink: 0 }} />
                    <InsertZone
                      isActive={isActiveAt(N - 1)}
                      color={line.color}
                      height={INSERT_ROW_H}
                      onClick={() => moveCursor(N - 1)}
                      onHoverChange={hoverPredecessor(line.stations[N - 1])}
                    />
                  </div>
                )}
              </div>
            );
          })()}
      </div>
    </section>
  );
}
