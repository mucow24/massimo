import { useSelection } from '../state/store';
import type { Station } from '../model/types';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { StationInspector } from './inspector';

// Shell width (matches .station-popover in styles.css) — used for the
// layout-edit pinned position.
const POPOVER_W = 320;
const EDGE_PAD = 8;

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
  view,
}: {
  station: Station;
  view: ViewportProjection;
  onClose: () => void;
}) {
  const { anchor, headerHandlers } = useDraggablePopover(
    station.id,
    { x: station.x, y: station.y },
    view,
  );
  const inLayoutEdit = useSelection((s) => s.uiMode.kind === 'editing-station-layout');
  const left = inLayoutEdit ? Math.max(EDGE_PAD, view.size.w - POPOVER_W - EDGE_PAD) : anchor.x;
  const top = inLayoutEdit ? EDGE_PAD : anchor.y;

  return (
    <div
      className="text-label-popover station-popover"
      style={{ position: 'absolute', left, top, zIndex: 1100 }}
      // Stop pointer events from reaching the canvas so clicks inside the
      // popover don't deselect the station or place items.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} />
      <div className="body">
        <StationInspector id={station.id} />
      </div>
    </div>
  );
}
