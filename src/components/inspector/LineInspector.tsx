import { useDoc, useSelection } from '../../state/store';
import type { LineId } from '../../model/types';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const selection = useSelection();
  const serviceField = useFieldHistory();

  if (!line) return null;

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
              <div className="list-row" style={{ paddingLeft: 0 }}>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
