import { useDoc } from '../state/store';
import type { Station } from '../model/types';
import { stationNameListText } from '../geometry/labelTokens';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { PopoverFooter } from './PopoverFooter';
import { StationInspector } from './inspector';

/**
 * The station editor as an on-canvas popover — stations join every other
 * entity type in ItemPopovers instead of living in the sidebar. Hosts the
 * full StationInspector, docked to the host's top-right corner like every
 * other canvas panel (usePinnedPopover) — which is also what keeps it off the
 * layout editor's handles, since that mode frames the station mid-canvas.
 *
 * Escape is owned by App's global handler, which runs the station step-out
 * ladder (sub-selection → layout-edit mode → the close-everything wipe that
 * deselects the station and unmounts this popover).
 */
export function StationPopover({
  station,
  hostW,
  hidden,
  onClose,
}: {
  station: Station;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  // Kept mounted but display:none during non-idle uiMode excursions.
  hidden?: boolean;
  onClose: () => void;
}) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const setStationLocked = useDoc((s) => s.setStationLocked);
  const deleteStation = useDoc((s) => s.deleteStation);
  // Title the panel with the station's short name — the same bullet-free,
  // tag-stripped text the stations list shows — falling back to "Station" for
  // an unnamed (or waypoint) station so the title band is never blank.
  const title = stationNameListText(station.name) || 'Station';

  return (
    <PopoverShell
      className="text-label-popover station-popover"
      title={title}
      left={anchor.x}
      top={anchor.y}
      hidden={hidden}
      shellRef={shellRef}
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
    </PopoverShell>
  );
}
