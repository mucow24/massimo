import { effectiveLineOrder, useDoc, useSelection } from '../state/store';
import { Inspector } from './Inspector';

export function Sidebar() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const selection = useSelection();
  const deleteStation = useDoc((s) => s.deleteStation);
  const deleteLine = useDoc((s) => s.deleteLine);
  const moveLineInOrder = useDoc((s) => s.moveLineInOrder);

  const stationList = Object.values(stations);
  const orderedLineIds = effectiveLineOrder(lineOrder, lines);

  return (
    <aside className="sidebar">
      <div className="scroll">
        <section>
          <h2>Stations ({stationList.length})</h2>
          {stationList.length === 0 && <div className="empty">No stations yet.</div>}
          {stationList.map((st) => (
            <div
              key={st.id}
              className={'list-row' + (selection.selectedStationId === st.id ? ' selected' : '')}
              onClick={() => selection.selectStation(st.id)}
              onMouseEnter={() => selection.setHoveredStation(st.id)}
              onMouseLeave={() => selection.setHoveredStation(null)}
            >
              <span className="grow">{st.name}</span>
              <button
                className="btn-mini danger"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete station "${st.name}"?`)) deleteStation(st.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </section>

        <section>
          <h2>Lines ({orderedLineIds.length})</h2>
          {orderedLineIds.length === 0 && <div className="empty">No lines yet.</div>}
          {orderedLineIds.map((id, i) => {
            const ln = lines[id];
            if (!ln) return null;
            return (
              <div
                key={ln.id}
                className={'list-row' + (selection.selectedLineId === ln.id ? ' selected' : '')}
                onClick={() => selection.selectLine(ln.id)}
                title="Top of list = front-most. Drag with ↑/↓ to reorder."
              >
                <span className="swatch" style={{ background: ln.color }} />
                <strong style={{ width: 28 }}>{ln.service}</strong>
                <span className="grow">{ln.stations.length} stations</span>
                <button
                  className="btn-mini"
                  disabled={i === 0}
                  title="Move up (forward)"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLineInOrder(ln.id, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn-mini"
                  disabled={i === orderedLineIds.length - 1}
                  title="Move down (backward)"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLineInOrder(ln.id, 1);
                  }}
                >
                  ↓
                </button>
                <button
                  className="btn-mini danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete line "${ln.service}"?`)) deleteLine(ln.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </section>

        <Inspector />
      </div>
    </aside>
  );
}
