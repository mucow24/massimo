import { memo, useEffect, useMemo, useState } from 'react';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useDoc, useSelection } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { useViewportStore } from '../state/viewportStore';
import { StylesPanel } from './StylesPanel';
import { LinesPanel } from './LinesPanel';
import { SortHeader, type SortDirection } from './SortHeader';
import { NONE_STOP_DOT_STYLE_ID } from '../model/dotStyle';
import type { Line, LineId, Station, StationId } from '../model/types';
import { legibleTextOn } from '../util/color';
import { stationNameListText } from '../geometry/labelTokens';

type StationSortColumn = 'name' | 'stops';

// Panel width — matches `.sidebar` in styles.css. The sidebar floats OVER the
// canvas host's right edge and stacks ABOVE the item popovers (.canvas-host
// isolation), so the popovers' top-right dock subtracts this strip while the
// panel shows.
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

// Per-station line lookups, one inversion of `line.stations` per `lines`
// identity instead of a filter over every line per row per render. Cached on
// the identity of the `lines` record (the stopMetrics `lastBuild` pattern) —
// sound because transforms are immutable, so any membership/service edit
// yields a new record, while a station move leaves `lines` untouched. One
// slot suffices: the sidebar is the only consumer and reads one doc.
export interface StationLineIndex {
  /** Lines stopping at the station, sorted by service code (badge order). */
  linesAt: Map<StationId, Line[]>;
  /** Stops-sort key: the sorted service codes joined with spaces. */
  stopsKey: Map<StationId, string>;
}

let lastLineIndex: { lines: Record<LineId, Line>; index: StationLineIndex } | null = null;

export function linesByStation(lines: Record<LineId, Line>): StationLineIndex {
  if (lastLineIndex && lastLineIndex.lines === lines) return lastLineIndex.index;
  const linesAt = new Map<StationId, Line[]>();
  for (const ln of Object.values(lines)) {
    for (const id of ln.stations) {
      const list = linesAt.get(id);
      if (list) list.push(ln);
      else linesAt.set(id, [ln]);
    }
  }
  const stopsKey = new Map<StationId, string>();
  for (const [id, list] of linesAt) {
    // Lists collect in Object.values order and the sort is stable, so each
    // matches the filter-then-sort it replaces element for element.
    list.sort((a, b) => a.service.localeCompare(b.service));
    stopsKey.set(id, list.map((ln) => ln.service).join(' '));
  }
  lastLineIndex = { lines, index: { linesAt, stopsKey } };
  return lastLineIndex.index;
}

const NO_LINES: readonly Line[] = [];

// Cleaned list text + sort bucket per Station OBJECT — the cleaning tokenizer
// is the dominant sort cost, and the name sort calls it per comparison. The
// WeakMap self-invalidates: a rename yields a new object (transforms are
// immutable), so stale text can't survive an edit.
const listNameCache = new WeakMap<Station, { text: string; rank: 0 | 1 }>();

function listNameOf(st: Station): { text: string; rank: 0 | 1 } {
  let entry = listNameCache.get(st);
  if (!entry) {
    const text = stationNameListText(st.name);
    entry = { text, rank: nameSortRank(text) };
    listNameCache.set(st, entry);
  }
  return entry;
}

// Clicking a station row pans the camera to it (zoom unchanged — this
// centers, it doesn't reframe), so the station the docked editor is editing
// is on screen. Read live via getState so the sidebar doesn't re-render on
// every pan/zoom.
const centerOnStation = (st: Station): void => {
  const { zoom, setViewport } = useViewportStore.getState();
  setViewport({ x: st.x, y: st.y, zoom });
};

interface StationRowProps {
  station: Station;
  badgeLines: readonly Line[];
  inSelection: boolean;
  soleSelected: boolean;
}

// One station row, memoized so a doc change re-renders only the rows whose
// inputs changed — a pure x/y move re-renders just the moved station's row
// (whose output is unchanged; no positional field is rendered). Handlers read
// the stores at event time (getState), so the memo has no callback props to
// go stale or defeat it.
const StationRow = memo(function StationRow({
  station,
  badgeLines,
  inSelection,
  soleSelected,
}: StationRowProps) {
  const label = listNameOf(station).text;
  return (
    <div data-station-row={station.id}>
      <div
        className={'list-row' + (inSelection ? ' selected' : '')}
        onClick={() => {
          useSelection.getState().selectStation(soleSelected ? null : station.id);
          // Center on the station when selecting it (not when the click is a
          // deselect of the sole-selected row).
          if (!soleSelected) centerOnStation(station);
        }}
        onMouseEnter={() => useSelection.getState().setHoveredStation(station.id)}
        onMouseLeave={() => useSelection.getState().setHoveredStation(null)}
      >
        {station.isWaypoint && (
          <span className="wp-pill" title="Waypoint">
            WP
          </span>
        )}
        {label.length > 0 ? (
          <span className="grow">{label}</span>
        ) : (
          <span className="grow no-name">(No name)</span>
        )}
        <span className="line-badges">
          {badgeLines
            // slice: the list is the shared index array — don't reverse it in
            // place.
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
                  const sel = useSelection.getState();
                  sel.setHoveredStation(null);
                  sel.startAppend(ln.id);
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
            useDoc.getState().deleteStation(station.id);
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
});

export function Sidebar() {
  // Render source, not the live doc: `stations` is rewritten on every
  // mid-drag pointermove, and a live subscription would re-run this component
  // (and the full station-list sort below) at input cadence while the
  // pipeline has the canvas frozen. The render source freezes with it, so
  // the sidebar re-renders at frame cadence instead. At rest the two stores
  // are identical.
  const stations = useRenderDoc((s) => s.stations);
  const lines = useRenderDoc((s) => s.lines);
  // The reserved "None" stop-dot is hidden from the Styles list, so it must not
  // inflate the tab's count either.
  const styleCount = useDoc(
    (s) => Object.keys(s.styles).filter((id) => id !== NONE_STOP_DOT_STYLE_ID).length,
  );
  const selection = useSelection();

  const [stationSortBy, setStationSortBy] = useState<StationSortColumn>('name');
  const [stationSortDir, setStationSortDir] = useState<SortDirection>('asc');

  const lineIndex = useMemo(() => linesByStation(lines), [lines]);

  // Memoized: the full-list sort (with per-compare name cleaning) is the
  // sidebar's one expensive computation, and re-renders that keep `stations`
  // identical — selection changes, landed drag frames touching other
  // collections — must not repeat it. (While a drag IS moving stations, the
  // render source hands out a new map per landed frame, so the sort still
  // reruns at frame cadence — that's the armed freeze's job to keep rare.)
  const stationList = useMemo(
    () =>
      Object.values(stations).sort((a, b) => {
        if (stationSortBy === 'name') {
          // Sort by the same cleaned text the list shows, so a leading tag or
          // bullet (`<b>…`, `|A| …`) can't order a row away from its visible name.
          const na = listNameOf(a);
          const nb = listNameOf(b);
          // Empty names and names starting with a nontraditional character (a
          // symbol/glyph like ✈, not a letter or digit) sink to the bottom in BOTH
          // directions — the direction toggle only reorders the ordinary names.
          if (na.rank !== nb.rank) return na.rank - nb.rank;
          const cmp = na.text.localeCompare(nb.text);
          return stationSortDir === 'asc' ? cmp : -cmp;
        }
        const cmp = (lineIndex.stopsKey.get(a.id) ?? '').localeCompare(
          lineIndex.stopsKey.get(b.id) ?? '',
        );
        return stationSortDir === 'asc' ? cmp : -cmp;
      }),
    [stations, stationSortBy, stationSortDir, lineIndex],
  );

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
    const box = el?.closest('.scroll');
    if (!el || !box) return;
    // `block: 'nearest'` by hand, over this box alone. `scrollIntoView` walks
    // every scrollable ancestor up to the document, and the sidebar rides the
    // right edge of a grid floored at the toolbar's `max-content` width — so in
    // a narrower window the row is outside the window entirely and the browser
    // obliges by scrolling the whole PAGE sideways to it, yanking the map out
    // from under the very click that selected the station.
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const delta = r.top < b.top ? r.top - b.top : r.bottom > b.bottom ? r.bottom - b.bottom : 0;
    if (delta !== 0) box.scrollTo({ top: box.scrollTop + delta, behavior: 'smooth' });
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
          Lines ({Object.keys(lines).length})
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
              <SortHeader
                label="Station"
                className="grow"
                active={stationSortBy === 'name'}
                dir={stationSortDir}
                onClick={() => handleStationSortClick('name')}
              />
              <SortHeader
                label="Lines"
                active={stationSortBy === 'stops'}
                dir={stationSortDir}
                onClick={() => handleStationSortClick('stops')}
              />
              <span className="header-spacer" aria-hidden />
            </div>
            {stationList.length === 0 && <div className="empty">No stations yet.</div>}
            {stationList.map((st) => {
              const ids = selection.selectedStationIds;
              // The editor lives in the on-canvas station popover now; a row
              // click selects (opening the popover), clicking the sole-
              // selected row again deselects (closing it).
              const soleSelected =
                ids.length === 1 &&
                ids[0] === st.id &&
                selection.selectedRouteBulletIds.length === 0;
              return (
                <StationRow
                  key={st.id}
                  station={st}
                  badgeLines={lineIndex.linesAt.get(st.id) ?? NO_LINES}
                  inSelection={ids.includes(st.id)}
                  soleSelected={soleSelected}
                />
              );
            })}
          </section>
        )}

        {selection.activeTab === 'lines' && <LinesPanel />}

        {selection.activeTab === 'styles' && <StylesPanel />}
      </div>
    </aside>
  );
}
