import { useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Cross2Icon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@radix-ui/react-icons';
import { effectiveLineOrder, useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { LineInspector } from './inspector';
import type { Line, Station } from '../model/types';
import { legibleTextOn } from '../util/color';
import { stationNameListText } from '../geometry/labelTokens';

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

  // Clicking a station row pans the camera to it (zoom unchanged — this
  // centers, it doesn't reframe). Uses the station origin, the same anchor
  // the on-canvas station popover attaches to, so the popover spawns next to
  // the now-centered station. Read live via getState so the sidebar doesn't
  // re-render on every pan/zoom.
  const centerOnStation = (st: Station): void => {
    const { zoom, setViewport } = useViewportStore.getState();
    setViewport({ x: st.x, y: st.y, zoom });
  };

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
        ? // Sort by the same cleaned text the list shows, so a leading tag or
          // bullet (`<b>…`, `|A| …`) can't order a row away from its visible name.
          stationNameListText(a.name).localeCompare(stationNameListText(b.name))
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

  // Scroll the selected line's editor into view when it becomes newly visible:
  // switching into the 'lines' tab (e.g. clicking a line bullet from the
  // stations tab), or the sidebar reappearing (selectLine auto-reveals it when
  // a line is picked while hidden). Plain in-tab clicks shouldn't reflow.
  const prevLinesTabRef = useRef(selection.activeTab);
  const prevSidebarOpenRef = useRef(selection.sidebarOpen);
  useEffect(() => {
    const wasOnLines = prevLinesTabRef.current === 'lines';
    const wasOpen = prevSidebarOpenRef.current;
    prevLinesTabRef.current = selection.activeTab;
    prevSidebarOpenRef.current = selection.sidebarOpen;
    if (!selection.sidebarOpen || selection.activeTab !== 'lines' || !selection.selectedLineId)
      return;
    if (wasOnLines && wasOpen) return; // already showing this list — in-tab click
    const el = document.querySelector(`[data-line-row="${selection.selectedLineId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selection.selectedLineId, selection.activeTab, selection.sidebarOpen]);

  // The counterpart to selectLine's auto-reveal: once the line selection is
  // cleared, collapse the sidebar again — but only if WE revealed it (a sidebar
  // the user opened stays put; manual tab/panel toggles clear the flag). Lives
  // here, not in the store, because the selection clears through many actions
  // (selectStation, Escape, delete, …) with no single choke point to hook.
  useEffect(() => {
    if (selection.selectedLineId || !selection.sidebarAutoRevealed) return;
    useSelection.setState({ sidebarOpen: false, sidebarAutoRevealed: false });
  }, [selection.selectedLineId, selection.sidebarAutoRevealed]);

  // Collapsed = the whole panel is gone: render nothing so the grid column can
  // shrink to zero and hand the space back to the map. The toolbar arrow (and
  // clicking the active tab) toggle `sidebarOpen`; reopening returns to
  // whichever tab was last active.
  //
  // Also hidden while the on-canvas station layout editor is active: that
  // popover pins to the host's top-right corner, directly over the sidebar, and
  // the canvas layer stacks BELOW the sidebar (see .canvas-host isolation in
  // styles.css) — so its controls would sit unreachable behind the panel.
  // Collapsing hands the corner to the editor. Derived purely from uiMode, so
  // `sidebarOpen` is untouched and the panel reappears as it was on exit.
  const inLayoutEdit = selection.uiMode.kind === 'editing-station-layout';
  if (!selection.sidebarOpen || inLayoutEdit) return null;

  return (
    <aside className="sidebar">
      <div className="tab-bar">
        <button
          className={'tab' + (selection.activeTab === 'stations' ? ' active' : '')}
          onClick={() => selection.toggleTab('stations')}
        >
          Stations ({stationList.length})
        </button>
        <button
          className={'tab' + (selection.activeTab === 'lines' ? ' active' : '')}
          onClick={() => selection.toggleTab('lines')}
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
                  <span className="sort-arrow">
                    {stationSortDir === 'asc' ? (
                      <TriangleUpIcon
                        role="img"
                        aria-label="sorted ascending"
                        width={12}
                        height={12}
                      />
                    ) : (
                      <TriangleDownIcon
                        role="img"
                        aria-label="sorted descending"
                        width={12}
                        height={12}
                      />
                    )}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={'sort-header' + (stationSortBy === 'stops' ? ' active' : '')}
                onClick={() => handleStationSortClick('stops')}
              >
                Lines
                {stationSortBy === 'stops' && (
                  <span className="sort-arrow">
                    {stationSortDir === 'asc' ? (
                      <TriangleUpIcon
                        role="img"
                        aria-label="sorted ascending"
                        width={12}
                        height={12}
                      />
                    ) : (
                      <TriangleDownIcon
                        role="img"
                        aria-label="sorted descending"
                        width={12}
                        height={12}
                      />
                    )}
                  </span>
                )}
              </button>
              <span className="header-spacer" aria-hidden />
            </div>
            {stationList.length === 0 && <div className="empty">No stations yet.</div>}
            {stationList.map((st) => {
              const ids = selection.selectedStationIds;
              const inSelection = ids.includes(st.id);
              // The editor lives in the on-canvas station popover now; a row
              // click selects (opening the popover), clicking the sole-
              // selected row again deselects (closing it).
              const soleSelected =
                ids.length === 1 &&
                ids[0] === st.id &&
                selection.selectedRouteBulletIds.length === 0;
              return (
                <div key={st.id} data-station-row={st.id}>
                  <div
                    className={'list-row' + (inSelection ? ' selected' : '')}
                    onClick={() => {
                      selection.selectStation(soleSelected ? null : st.id);
                      // Center on the station when selecting it (not when the
                      // click is a deselect of the sole-selected row).
                      if (!soleSelected) centerOnStation(st);
                    }}
                    onMouseEnter={() => selection.setHoveredStation(st.id)}
                    onMouseLeave={() => selection.setHoveredStation(null)}
                  >
                    <span className="grow">{stationNameListText(st.name)}</span>
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
                            <span className="line-badge__code">{ln.service}</span>
                          </span>
                        ))}
                    </span>
                    <button
                      className="btn-mini danger"
                      aria-label="Delete station"
                      title="Delete station"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteStation(st.id);
                      }}
                    >
                      <Cross2Icon />
                    </button>
                  </div>
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
                      <ChevronUpIcon />
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
                      <ChevronDownIcon />
                    </button>
                    <button
                      className="btn-mini danger"
                      aria-label="Delete line"
                      title="Delete line"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLine(ln.id);
                      }}
                    >
                      <Cross2Icon />
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
