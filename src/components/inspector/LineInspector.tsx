import { useDoc, useSelection } from '../../state/store';
import type { LineId } from '../../model/types';
import { ColorPalette } from './ColorPalette';
import { useFieldHistory } from '../useFieldHistory';

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const selection = useSelection();
  const serviceField = useFieldHistory();

  if (!line) return null;

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
        {line.stations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {line.stations.map((sid, i) => {
              const st = stations[sid];
              if (!st) return null;
              const isFirst = i === 0;
              const isLast = i === line.stations.length - 1;
              const ROW_H = 26;
              const BAND_W = 14;
              return (
                <div
                  key={i + ':' + sid}
                  className="list-row"
                  style={{
                    padding: '0 12px 0 0',
                    gap: 0,
                    height: ROW_H,
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
                  <div
                    style={{
                      position: 'relative',
                      width: 24,
                      height: ROW_H,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: BAND_W,
                        background: line.color,
                        top: isFirst ? `calc(50% - ${BAND_W / 2}px)` : 0,
                        bottom: isLast ? `calc(50% - ${BAND_W / 2}px)` : 0,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#000',
                      }}
                    />
                  </div>
                  <span className="grow" style={{ paddingLeft: 8 }}>
                    {st.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
