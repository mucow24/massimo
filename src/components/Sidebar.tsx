import { useEffect, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Cross2Icon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@radix-ui/react-icons';
import { effectiveLineOrder, useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { StylesPanel } from './StylesPanel';
import { NONE_STOP_DOT_STYLE_ID } from '../model/dotStyle';
import type { Line, Station } from '../model/types';
import { lineDisplayName } from '../model/lineNaming';
import { legibleTextOn } from '../util/color';
import { stationNameListText } from '../geometry/labelTokens';

type StationSortColumn = 'name' | 'stops';
type SortDirection = 'asc' | 'desc';

// Panel width — matches `.sidebar` in styles.css. The sidebar floats OVER the
// canvas host's right edge and stacks ABOVE the item popovers (.canvas-host
// isolation), so spawn placement subtracts this strip while the panel shows.
export const SIDEBAR_WIDTH = 320;

/** Whether the sidebar panel is actually showing (mirrors Sidebar's render
 * gate): open, and not ceded to a pinned top-right editor popover — the
 * station layout editor's, or the line editor's (Edit Stops). */
export const sidebarVisible = (s: { sidebarOpen: boolean; uiMode: { kind: string } }): boolean =>
  s.sidebarOpen &&
  s.uiMode.kind !== 'editing-station-layout' &&
  s.uiMode.kind !== 'appending-to-line';

// Name-sort bucket: 0 for a "traditional" name (cleaned text begins with a
// letter or digit), 1 for anything else — an empty name, or one starting with a
// symbol/glyph like ✈. Bucket 1 always sorts after bucket 0, so these rows sink
// to the bottom of the name-sorted list regardless of sort direction.
function nameSortRank(cleaned: string): 0 | 1 {
  return /^[\p{L}\p{N}]/u.test(cleaned) ? 0 : 1;
}

export function Sidebar() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  // The reserved "None" stop-dot is hidden from the Styles list, so it must not
  // inflate the tab's count either.
  const styleCount = useDoc(
    (s) => Object.keys(s.styles).filter((id) => id !== NONE_STOP_DOT_STYLE_ID).length,
  );
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
    if (stationSortBy === 'name') {
      // Sort by the same cleaned text the list shows, so a leading tag or
      // bullet (`<b>…`, `|A| …`) can't order a row away from its visible name.
      const na = stationNameListText(a.name);
      const nb = stationNameListText(b.name);
      // Empty names and names starting with a nontraditional character (a
      // symbol/glyph like ✈, not a letter or digit) sink to the bottom in BOTH
      // directions — the direction toggle only reorders the ordinary names.
      const ra = nameSortRank(na);
      const rb = nameSortRank(nb);
      if (ra !== rb) return ra - rb;
      const cmp = na.localeCompare(nb);
      return stationSortDir === 'asc' ? cmp : -cmp;
    }
    const cmp = stopsKey(a.id).localeCompare(stopsKey(b.id));
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

  // Collapsed = the whole panel is gone: render nothing so the grid column can
  // shrink to zero and hand the space back to the map. The toolbar arrow (and
  // clicking the active tab) toggle `sidebarOpen`; reopening returns to
  // whichever tab was last active.
  //
  // Also hidden while a pinned top-right editor is active — the station layout
  // editor's popover or the line editor's (Edit Stops): both pin to the host's
  // top-right corner, directly over the sidebar, and the canvas layer stacks
  // BELOW the sidebar (see .canvas-host isolation in styles.css) — so their
  // controls would sit unreachable behind the panel. Collapsing hands the
  // corner to the editor. Derived purely from uiMode, so `sidebarOpen` is
  // untouched and the panel reappears as it was on exit.
  if (!sidebarVisible(selection)) return null;

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
        <button
          className={'tab' + (selection.activeTab === 'styles' ? ' active' : '')}
          onClick={() => selection.toggleTab('styles')}
        >
          Styles ({styleCount})
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
                    {st.isWaypoint && (
                      <span className="wp-pill" title="Waypoint">
                        WP
                      </span>
                    )}
                    {(() => {
                      const label = stationNameListText(st.name);
                      return label.length > 0 ? (
                        <span className="grow">{label}</span>
                      ) : (
                        <span className="grow no-name">(No name)</span>
                      );
                    })()}
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
                              selection.startAppend(ln.id);
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
                        // The one delete path that doesn't clear selection
                        // first (popover delete + the Delete key both do):
                        // reconcile so a selected row's id can't dangle — a
                        // ghost member corrupts the next shift-click
                        // multi-selection.
                        useSelection.getState().reconcileWithDoc(useDoc.getState());
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
              return (
                <div key={ln.id} data-line-row={ln.id} style={{ padding: '4px 0' }}>
                  <div
                    className="list-row"
                    // Straight into Edit Stops — there is no selected-but-not-
                    // editing state. The editor itself is the pinned line
                    // popover; the whole panel hides while the mode is active
                    // (see sidebarVisible), so this list never shows a
                    // selected row.
                    onClick={() => selection.startAppend(ln.id)}
                    title="Default stacking: top of list paints front-most where lines overlap (regions can override per overlap). Use ↑/↓ to reorder."
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
                      {lineDisplayName(ln)} · {ln.stations.length} stations
                    </span>
                    <button
                      className="btn-mini icon"
                      disabled={i === 0}
                      title="Move up (paint further forward)"
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
                      title="Move down (paint further back)"
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
                </div>
              );
            })}
          </section>
        )}

        {selection.activeTab === 'styles' && <StylesPanel />}
      </div>
    </aside>
  );
}
