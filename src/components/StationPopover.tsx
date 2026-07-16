import { useState } from 'react';
import { useDoc, useSelection } from '../state/store';
import type { Station } from '../model/types';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { useRenameEditor } from './useRenameEditor';
import { PopoverFooter } from './PopoverFooter';
import { StationInspector } from './inspector';

// Shell width (matches .station-popover in styles.css) — used for the
// layout-edit pinned position.
const POPOVER_W = 320;
const EDGE_PAD = 8;

/**
 * The titlebar's rename textarea: mounted only while editing, so
 * useRenameEditor's mount-scoped history group brackets exactly one rename.
 * Same protocol as the on-canvas double-click editor (StationNameEditor):
 * live rename while typing, Enter commits, Shift+Enter newline, Escape
 * closes, Ctrl+Z undoes the whole rename in one step.
 */
function StationTitleEditor({ station, onClose }: { station: Station; onClose: () => void }) {
  const renameStation = useDoc((s) => s.renameStation);
  const editor = useRenameEditor(onClose);
  return (
    <textarea
      className="title-rename"
      aria-label="Station name"
      rows={Math.max(1, station.name.split('\n').length)}
      value={station.name}
      onChange={(e) => renameStation(station.id, e.target.value)}
      // The header is the drag handle: a click into the textarea must not
      // start a popover drag.
      onPointerDown={(e) => e.stopPropagation()}
      {...editor}
    />
  );
}

/**
 * The station editor as an on-canvas popover — stations join every other
 * entity type in ItemPopovers instead of living in the sidebar. Hosts the
 * full StationInspector; draggable by the header; anchored to the station's
 * position at selection time (useDraggablePopover owns the visual gap and
 * clamps the spawn into the host, so selecting an off-screen station from
 * the sidebar list still shows the editor).
 *
 * While the layout editor is active the popover pins to the host's
 * top-right corner instead: its default spot next to the station would sit
 * exactly over the handles the mode exists to expose (the mode's framing
 * effect centers the station under it).
 *
 * Escape is owned by App's global handler, which runs the station step-out
 * ladder (sub-selection → layout-edit mode → the close-everything wipe that
 * deselects the station and unmounts this popover).
 */
export function StationPopover({
  station,
  worldRect,
  view,
  spawnBox,
  hidden,
  onClose,
}: {
  station: Station;
  // The station silhouette's world AABB (cells + name label) at the moment of
  // selection — the spawn opens the editor beside it.
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  // Kept mounted but display:none during non-idle uiMode excursions, so the
  // frozen anchor survives and the panel returns to the same canvas point.
  hidden?: boolean;
  onClose: () => void;
}) {
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    station.id,
    worldRect,
    view,
    hidden,
    spawnBox,
  );
  const setStationLocked = useDoc((s) => s.setStationLocked);
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
  const deleteStation = useDoc((s) => s.deleteStation);
  const inLayoutEdit = useSelection((s) => s.uiMode.kind === 'editing-station-layout');
  const left = inLayoutEdit ? Math.max(EDGE_PAD, view.size.w - POPOVER_W - EDGE_PAD) : anchor.x;
  const top = inLayoutEdit ? EDGE_PAD : anchor.y;
  // Title rename state. Reset when MapCanvas reuses this popover instance for
  // another station (same render-time pattern as useDraggablePopover).
  const [renaming, setRenaming] = useState(false);
  const [prevId, setPrevId] = useState(station.id);
  if (prevId !== station.id) {
    setPrevId(station.id);
    setRenaming(false);
  }

  return (
    <DraggablePopoverShell
      className="text-label-popover station-popover"
      // Rename opens from the header DIV, not the title span: the drag's
      // pointer capture retargets click/dblclick to the band (see the prop's
      // comment in DraggablePopoverShell).
      onHeaderDoubleClick={
        station.locked
          ? undefined
          : (e) => {
              // A fast double-toggle of the WP pill (also in the band) must
              // not open the rename editor on top of it.
              if (e.target instanceof Element && e.target.closest('button')) return;
              setRenaming(true);
            }
      }
      // The titlebar IS the station's name (double-click to rename), with the
      // WP lozenge on the far right.
      title={
        <>
          {renaming ? (
            <StationTitleEditor station={station} onClose={() => setRenaming(false)} />
          ) : (
            <span
              // `renameable` drives the map-name-style hover underline; a
              // locked station doesn't advertise a rename it won't do.
              className={`title-name${station.locked ? '' : ' renameable'}`}
              title={station.locked ? undefined : 'Double-click to rename'}
            >
              {station.name || 'Station'}
            </span>
          )}
          {/* The same lozenge the canvas draws for a waypoint (gray pill,
              white WP): outline while off, filled while on. Waypoint is
              per-station styling that never mirrors, like lock. It lives
              outside the inspector's disabled fieldset now, so the locked
              freeze is explicit. */}
          <button
            type="button"
            className={`wp-pill-btn${station.isWaypoint ? ' active' : ''}`}
            aria-pressed={!!station.isWaypoint}
            aria-label="Waypoint"
            disabled={!!station.locked}
            title={
              station.isWaypoint
                ? 'Waypoint on — name + bullets hidden'
                : 'Mark as waypoint (hide name + bullets)'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStationWaypoint(station.id, !station.isWaypoint)}
          >
            WP
          </button>
        </>
      }
      left={left}
      top={top}
      hidden={hidden}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <StationInspector id={station.id} />
      {/* Same footer as every other item popover. While locked, the
          inspector's fieldset greys out every editing control (and the
          header's WP + rename freeze too); the lock toggle lives here in the
          footer, outside all of that, so unlocking stays reachable. Delete is
          disabled while locked, matching the canvas protection. */}
      <PopoverFooter
        noun="station"
        locked={!!station.locked}
        onToggleLock={() => setStationLocked(station.id, !station.locked)}
        onDelete={() => {
          deleteStation(station.id);
          onClose();
        }}
      />
    </DraggablePopoverShell>
  );
}
