import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveLineOrder, useDoc, useSelection } from '../state/store';
import { LineInspector, StationInspector } from './inspector';
import type { Line } from '../model/types';
import { legibleTextOn } from '../util/color';
import { InlineBulletText } from './InlineBulletText';

type StationSortColumn = 'name' | 'stops';
type SortDirection = 'asc' | 'desc';

export function Sidebar() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const selection = useSelection();
  const deleteStation = useDoc((s) => s.deleteStation);
  const deleteLine = useDoc((s) => s.deleteLine);
  const moveLineInOrder = useDoc((s) => s.moveLineInOrder);

  const [stationSortBy, setStationSortBy] = useState<StationSortColumn>('name');
  const [stationSortDir, setStationSortDir] = useState<SortDirection>('asc');

  const orderedLineIds = effectiveLineOrder(lineOrder, lines);

  // Service-code → line lookup for `<CODE>` bullet tokens that appear inline
  // in station names. Built once per render; cheap to rebuild.
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(lines)) map.set(ln.service, ln);
    return map;
  }, [lines]);

  // Per-station: lines that stop here, alphabetical by service code.
  const linesAtStation = (stationId: string): Line[] =>
    Object.values(lines)
      .filter((ln) => ln.stations.includes(stationId))
      .sort((a, b) => a.service.localeCompare(b.service));

  const stopsKey = (stationId: string): string =>
    linesAtStation(stationId)
      .map((ln) => ln.service)
      .join(' ');

  const stationList = Object.values(stations).sort((a, b) => {
    const cmp =
      stationSortBy === 'name'
        ? a.name.localeCompare(b.name)
        : stopsKey(a.id).localeCompare(stopsKey(b.id));
    return stationSortDir === 'asc' ? cmp : -cmp;
  });

  const handleStationSortClick = (col: StationSortColumn) => {
    if (stationSortBy === col) {
      setStationSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setStationSortBy(col);
      setStationSortDir('asc');
    }
  };

  // Scroll the expanded editor into view when something gets selected from
  // outside the sidebar (e.g. clicking a station on the canvas). Use the
  // anchor (last clicked) so scroll follows the most recent action.
  const ids = selection.selectedStationIds;
  const stationAnchorId = ids.length > 0 ? ids[ids.length - 1] : null;
  useEffect(() => {
    if (selection.activeTab !== 'stations' || !stationAnchorId) return;
    const el = document.querySelector(`[data-station-row="${stationAnchorId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [stationAnchorId, selection.activeTab]);

  // Only scroll when the tab just transitioned to 'lines' (e.g. clicking a
  // line bullet from the stations tab). In-tab clicks shouldn't reflow.
  const prevLinesTabRef = useRef(selection.activeTab);
  useEffect(() => {
    const wasOnLines = prevLinesTabRef.current === 'lines';
    prevLinesTabRef.current = selection.activeTab;
    if (selection.activeTab !== 'lines' || !selection.selectedLineId) return;
    if (wasOnLines) return;
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
            <div className="list-header">
              <button
                type="button"
                className={'sort-header grow' + (stationSortBy === 'name' ? ' active' : '')}
                onClick={() => handleStationSortClick('name')}
              >
                Station
                {stationSortBy === 'name' && (
                  <span className="sort-arrow">{stationSortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
              <button
                type="button"
                className={'sort-header' + (stationSortBy === 'stops' ? ' active' : '')}
                onClick={() => handleStationSortClick('stops')}
              >
                Lines
                {stationSortBy === 'stops' && (
                  <span className="sort-arrow">{stationSortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
              <span className="header-spacer" aria-hidden />
            </div>
            {stationList.length === 0 && <div className="empty">No stations yet.</div>}
            {stationList.map((st) => {
              const ids = selection.selectedStationIds;
              const inSelection = ids.includes(st.id);
              // Inline editor only opens for true single-selection — no
              // other stations and no bullets in the selection set.
              const expanded =
                ids.length === 1 &&
                ids[0] === st.id &&
                selection.selectedRouteBulletIds.length === 0;
              return (
                <div key={st.id} data-station-row={st.id}>
                  <div
                    className={'list-row' + (inSelection ? ' selected' : '')}
                    onClick={() => selection.selectStation(expanded ? null : st.id)}
                    onMouseEnter={() => selection.setHoveredStation(st.id)}
                    onMouseLeave={() => selection.setHoveredStation(null)}
                  >
                    <span className="grow">
                      <InlineBulletText text={st.name} lineByService={lineByService} />
                    </span>
                    {st.isWaypoint && (
                      <span className="wp-pill" title="Waypoint">
                        WP
                      </span>
                    )}
                    <span className="line-badges">
                      {linesAtStation(st.id)
                        .slice()
                        .reverse()
                        .map((ln) => (
                          <span
                            key={ln.id}
                            className="line-badge"
                            style={{
                              background: ln.color,
                              color: legibleTextOn(ln.color),
                              cursor: 'pointer',
                            }}
                            title={`Edit line ${ln.service}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selection.setHoveredStation(null);
                              selection.selectLine(ln.id);
                            }}
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
            {orderedLineIds.length === 0 && <div className="empty">No lines yet.</div>}
            {orderedLineIds.map((id, i) => {
              const ln = lines[id];
              if (!ln) return null;
              const expanded = selection.selectedLineId === ln.id;
              return (
                <div
                  key={ln.id}
                  data-line-row={ln.id}
                  style={{
                    padding: '4px 0',
                    ...(expanded ? { outline: `4px solid ${ln.color}`, outlineOffset: -4 } : {}),
                  }}
                >
                  <div
                    className={'list-row' + (expanded ? ' selected' : '')}
                    onClick={() => selection.selectLine(expanded ? null : ln.id)}
                    title="Same-layer tiebreaker: top of list = front-most among lines sharing a layer. Use ↑/↓ to reorder."
                  >
                    <span
                      className="line-badge"
                      style={{
                        background: ln.color,
                        color: legibleTextOn(ln.color),
                        width: 24,
                        height: 24,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {ln.service}
                    </span>
                    <span className="grow">
                      {ln.name || `${ln.service} line`} · {ln.stations.length} stations
                    </span>
                    <button
                      className="btn-mini icon"
                      disabled={i === 0}
                      title="Move up (forward among same-layer lines)"
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
                      title="Move down (backward among same-layer lines)"
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
                    <div className="inline-editor" style={{ border: 'none' }}>
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
