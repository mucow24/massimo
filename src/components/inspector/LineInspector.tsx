import { useDoc, useSelection } from '../../state/store';
import type { LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';
import { SegmentStyleDivider } from './SegmentStyleDivider';

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
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const selection = useSelection();
  const serviceField = useFieldHistory();

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
        {line.stations.map((sid, i) => {
          const st = stations[sid];
          if (!st) return null;
          const isActiveCursor = isAppending && selection.insertAfterIndex === i;
          return (
            <div key={i + ':' + sid}>
              <div
                className="list-row"
                style={{ paddingLeft: 0 }}
                onMouseEnter={() => {
                  selection.setHoveredLineStop({ lineId: line.id, stationId: sid });
                  selection.setHoveredStation(sid);
                }}
                onMouseLeave={() => {
                  selection.setHoveredLineStop(null);
                  selection.setHoveredStation(null);
                }}
              >
                <span style={{ width: 18, color: '#999' }}>{i + 1}.</span>
                <span className="grow">{st.name}</span>
                <button className="btn-mini icon" disabled={i === 0} onClick={() => moveSt(i, -1)}>
                  ↑
                </button>
                <button
                  className="btn-mini icon"
                  disabled={i === line.stations.length - 1}
                  onClick={() => moveSt(i, 1)}
                >
                  ↓
                </button>
                {isActiveCursor ? (
                  <button
                    className="btn-mini icon"
                    onClick={() => selection.setAppending(null)}
                    style={{ background: line.color, color: '#fff', borderColor: line.color }}
                    title="Stop adding stations"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    className="btn-mini icon"
                    onClick={() => selection.startAppendAt(line.id, i)}
                    title={`Insert stations after ${st.name}`}
                  >
                    +
                  </button>
                )}
                <button
                  className="btn-mini danger"
                  onClick={() => removeStationFromLine(line.id, i)}
                >
                  ×
                </button>
              </div>
              {isActiveCursor && (
                <div
                  style={{
                    height: 3,
                    background: line.color,
                    margin: '2px 0',
                    borderRadius: 1.5,
                  }}
                />
              )}
              {i < line.stations.length - 1 &&
                (() => {
                  const nextSid = line.stations[i + 1];
                  if (!stations[nextSid]) return null;
                  const key = pairKeyOf(sid, nextSid);
                  const style = (line.segmentStyles?.[key] ?? 'solid') as LineStyle;
                  return (
                    <SegmentStyleDivider
                      style={style}
                      color={line.color}
                      lineId={line.id}
                      fromStationId={sid}
                      toStationId={nextSid}
                      onClick={() => cycleSegmentStyle(sid, nextSid)}
                    />
                  );
                })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}
