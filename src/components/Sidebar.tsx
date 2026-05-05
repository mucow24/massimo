import { useEffect } from 'react';
import { effectiveLineOrder, useDoc, useSelection } from '../state/store';
import { LineInspector, StationInspector } from './Inspector';
import type { Line } from '../state/types';
import { legibleTextOn } from '../util/color';

export function Sidebar() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();
  const deleteStation = useDoc((s) => s.deleteStation);
  const deleteLine = useDoc((s) => s.deleteLine);
  const moveLineInOrder = useDoc((s) => s.moveLineInOrder);

  const stationList = Object.values(stations);
  const orderedLineIds = effectiveLineOrder(lineOrder, lines);

  // Per-station: lines that stop here, alphabetical by service code.
  const linesAtStation = (stationId: string): Line[] =>
    Object.values(lines)
      .filter((ln) => ln.stations.includes(stationId))
      .sort((a, b) => a.service.localeCompare(b.service));

  const onNewLine = () => {
    const id = addLine();
    selection.startAppendAt(id, -1);
  };

  // Scroll the expanded editor into view when something gets selected from
  // outside the sidebar (e.g. clicking a station on the canvas).
  useEffect(() => {
    if (selection.activeTab !== 'stations' || !selection.selectedStationId) return;
    const el = document.querySelector(`[data-station-row="${selection.selectedStationId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selection.selectedStationId, selection.activeTab]);

  useEffect(() => {
    if (selection.activeTab !== 'lines' || !selection.selectedLineId) return;
    const el = document.querySelector(`[data-line-row="${selection.selectedLineId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selection.selectedLineId, selection.activeTab]);

  return (
    <aside className="sidebar">
      <div className="tab-bar">
        <button
          className={'tab' + (selection.activeTab === 'stations' ? ' active' : '')}
          onClick={() => selection.setActiveTab('stations')}
        >
          Stations ({stationList.length})
        </button>
        <button
          className={'tab' + (selection.activeTab === 'lines' ? ' active' : '')}
          onClick={() => selection.setActiveTab('lines')}
        >
          Lines ({orderedLineIds.length})
        </button>
      </div>

      <div className="scroll">
        {selection.activeTab === 'stations' && (
          <section>
            {stationList.length === 0 && <div className="empty">No stations yet.</div>}
            {stationList.map((st) => {
              const expanded = selection.selectedStationId === st.id;
              return (
                <div key={st.id} data-station-row={st.id}>
                  <div
                    className={'list-row' + (expanded ? ' selected' : '')}
                    onClick={() => selection.selectStation(expanded ? null : st.id)}
                    onMouseEnter={() => selection.setHoveredStation(st.id)}
                    onMouseLeave={() => selection.setHoveredStation(null)}
                  >
                    <span className="grow">{st.name}</span>
                    <span className="line-badges">
                      {linesAtStation(st.id).map((ln) => (
                        <span
                          key={ln.id}
                          className="line-badge"
                          style={{ background: ln.color, color: legibleTextOn(ln.color) }}
                          title={`Line ${ln.service}`}
                        >
                          {ln.service}
                        </span>
                      ))}
                    </span>
                    <button
                      className="btn-mini danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteStation(st.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {expanded && (
                    <div className="inline-editor">
                      <StationInspector id={st.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {selection.activeTab === 'lines' && (
          <section>
            <div className="tab-actions">
              <button onClick={onNewLine}>+ New line</button>
            </div>
            {orderedLineIds.length === 0 && <div className="empty">No lines yet.</div>}
            {orderedLineIds.map((id, i) => {
              const ln = lines[id];
              if (!ln) return null;
              const expanded = selection.selectedLineId === ln.id;
              return (
                <div key={ln.id} data-line-row={ln.id}>
                  <div
                    className={'list-row' + (expanded ? ' selected' : '')}
                    onClick={() => selection.selectLine(expanded ? null : ln.id)}
                    title="Top of list = front-most. Use ↑/↓ to reorder."
                  >
                    <span className="swatch" style={{ background: ln.color }} />
                    <strong style={{ width: 28 }}>{ln.service}</strong>
                    <span className="grow">{ln.stations.length} stations</span>
                    <button
                      className="btn-mini icon"
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
                      className="btn-mini icon"
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
                        deleteLine(ln.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {expanded && (
                    <div className="inline-editor">
                      <LineInspector id={ln.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </aside>
  );
}
