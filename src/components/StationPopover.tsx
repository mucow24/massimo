import { useDoc, useSelection } from '../state/store';
import type { Station } from '../model/types';
import { stationNameListText } from '../geometry/labelTokens';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell, pinnedTopRight } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { PopoverFooter } from './PopoverFooter';
import { StationInspector } from './inspector';

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
  const deleteStation = useDoc((s) => s.deleteStation);
  const inLayoutEdit = useSelection((s) => s.uiMode.kind === 'editing-station-layout');
  const pin = pinnedTopRight(view.size.w);
  const left = inLayoutEdit ? pin.left : anchor.x;
  const top = inLayoutEdit ? pin.top : anchor.y;
  // Title the panel with the station's short name — the same bullet-free,
  // tag-stripped text the stations list shows — falling back to "Station" for
  // an unnamed (or waypoint) station so the drag-handle band is never blank.
  const title = stationNameListText(station.name) || 'Station';

  return (
    <DraggablePopoverShell
      className="text-label-popover station-popover"
      title={title}
      left={left}
      top={top}
      hidden={hidden}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <StationInspector id={station.id} />
      {/* Same footer as every other item popover. Lock protects canvas
          geometry only — the inspector above stays fully editable while
          locked (the station-specific rule) — and Delete is disabled while
          locked, matching the canvas protection. */}
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
