import { Fragment } from 'react';
import { useDoc, useSelection } from '../../state/store';
import type { LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';

const STATION_ROW_H = 20;
const GAP_ROW_H = 16;
const BAND_W = 14;
const MARKER_W = 24;

const NEXT_STYLE: Record<LineStyle, LineStyle> = {
  solid: 'dashed',
  dashed: 'hatched',
  hatched: 'hatched-mirror',
  'hatched-mirror': 'solid',
};

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const selection = useSelection();
  const serviceField = useFieldHistory();

  if (!line) return null;

  const cycleSegmentStyle = (fromStationId: string, toStationId: string) => {
    const key = pairKeyOf(fromStationId, toStationId);
    const cur = (line.segmentStyles?.[key] ?? 'solid') as LineStyle;
    setLineSegmentStyle(line.id, fromStationId, toStationId, NEXT_STYLE[cur]);
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
        {line.stations.length === 0 && (
          <button
            className="btn-mini"
            onClick={() => selection.startAppendAt(line.id, -1)}
            style={
              isAppending
                ? { background: line.color, color: '#fff', borderColor: line.color }
                : undefined
            }
          >
            {isAppending ? 'Stop adding' : 'Add stations from map'}
          </button>
        )}
        {line.stations.length > 0 &&
          (() => {
            const isStartCursor = isAppending && selection.insertAfterIndex === -1;
            return (
              <>
                <button
                  className="btn-mini"
                  onClick={() =>
                    isStartCursor
                      ? selection.setAppending(null)
                      : selection.startAppendAt(line.id, -1)
                  }
                  style={{
                    width: '100%',
                    padding: '1px 6px',
                    ...(isStartCursor
                      ? { background: line.color, color: '#fff', borderColor: line.color }
                      : {}),
                  }}
                  title="Insert stations before the first station"
                >
                  {isStartCursor ? 'Stop adding' : '+ Add before start'}
                </button>
                {isStartCursor && (
                  <div
                    style={{
                      height: 3,
                      background: line.color,
                      margin: '2px 0',
                      borderRadius: 1.5,
                    }}
                  />
                )}
              </>
            );
          })()}
        {line.stations.length > 0 &&
          (() => {
            const N = line.stations.length;
            const totalH = N * STATION_ROW_H + Math.max(0, N - 1) * GAP_ROW_H;
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
            return (
              <div
                style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
              >
                <svg
                  width={MARKER_W}
                  height={totalH}
                  style={{
                    position: 'absolute',
                    top: 0,
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
                  {line.stations.map(
                    (sid, i) =>
                      stations[sid] && (
                        <circle
                          key={i + ':' + sid}
                          cx={MARKER_W / 2}
                          cy={centerOf(i)}
                          r={4}
                          fill="#000"
                        />
                      ),
                  )}
                </svg>
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
                        <span className="grow" style={{ paddingLeft: 8 }}>
                          {st.name}
                        </span>
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
                            </div>
                          );
                        })()}
                    </Fragment>
                  );
                })}
              </div>
            );
          })()}
      </div>
    </section>
  );
}
