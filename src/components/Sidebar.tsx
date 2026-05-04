import { useDoc, useSelection } from '../state/store';
import { Inspector } from './Inspector';

export function Sidebar() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const selection = useSelection();
  const deleteStation = useDoc((s) => s.deleteStation);
  const deleteLine = useDoc((s) => s.deleteLine);

  const stationList = Object.values(stations);
  const lineList = Object.values(lines);

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
          <h2>Lines ({lineList.length})</h2>
          {lineList.length === 0 && <div className="empty">No lines yet.</div>}
          {lineList.map((ln) => (
            <div
              key={ln.id}
              className={'list-row' + (selection.selectedLineId === ln.id ? ' selected' : '')}
              onClick={() => selection.selectLine(ln.id)}
            >
              <span className="swatch" style={{ background: ln.color }} />
              <strong style={{ width: 28 }}>{ln.service}</strong>
              <span className="grow">{ln.stations.length} stations</span>
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
          ))}
        </section>

        <Inspector />
      </div>
    </aside>
  );
}
