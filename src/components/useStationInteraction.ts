import { Line, LineId, Station } from '../model/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { useSnapPrefs } from '../state/snapPrefs';
import { stopPosWorld } from '../geometry/interlining';
import { pathBetweenStations } from '../model/pathSelect';
import { rotateItemOnContextMenu } from './canvas/groupRotate';
import { itemCursor } from './canvas/itemCursor';
import { screenToWorld } from './canvas/viewportMath';

// Map a click on a station to the closest dot's lineId. Used to pin a
// transfer endpoint to the specific stop the user clicked on, rather than
// the station's anchor center.
function closestStopLineId(station: Station, e: React.MouseEvent): LineId | null {
  if (station.stops.length === 0) return null;
  const svg = document.querySelector('.canvas-host svg') as SVGSVGElement | null;
  if (!svg) return station.stops[0].lineId;
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  // Reuse the canonical screen→world projection rather than re-deriving the
  // formula inline — the viewBox/rect mapping is load-bearing and must not
  // drift from useViewport's screenToWorld.
  const { x: wx, y: wy } = screenToWorld(
    { x: e.clientX, y: e.clientY },
    { vbX: vb.x, vbY: vb.y, vbW: vb.width, vbH: vb.height },
    rect,
  );
  let bestId = station.stops[0].lineId;
  let bestDist = Infinity;
  for (const cell of station.stops) {
    const { x: sx, y: sy } = stopPosWorld(cell, station);
    const d = Math.hypot(wx - sx, wy - sy);
    if (d < bestDist) {
      bestDist = d;
      bestId = cell.lineId;
    }
  }
  return bestId;
}

/**
 * Pointer / click / context-menu / double-click handling for a station,
 * shared by both the bg hit-rect AND the dots layer. The dots wrapper reuses
 * these so a click on a station dot is routed to the same station onClick
 * logic the bg would have run — keeping dot pixels as a "click target for the
 * station" even though the dots layer paints above transfers in z-order.
 *
 * In add-line-tag mode, station hit rects (which extend past the visible
 * footprint) would block hover/click on bands passing nearby. We pass through
 * so the cursor goes straight to the band stripes.
 *
 * While placing a transfer (either pick), surface a 3px white stroke on
 * whichever dot the cursor is closest to. Active for BOTH the first and second
 * picks; the second-pick code path also guards against highlighting the same
 * dot as the already-committed anchor (a no-op self-transfer that the click
 * handler would reject).
 *
 * Returns `inHitlessMode` so callers can also drop their hit rect's
 * pointer-events, and a cursor that reflects hand/pan mode.
 */
export function useStationInteraction(
  station: Station,
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void,
  lines: Record<string, Line>,
) {
  const selection = useSelection();
  const rotateStation = useDoc((s) => s.rotateStation);
  const toggleStationOnLine = useDoc((s) => s.toggleStationOnLine);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const addTransfer = useDoc((s) => s.addTransfer);
  const gridMode = useSnapPrefs((s) => s.modes.grid);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // In hand mode, let the event bubble to the SVG so it becomes a pan.
    if (selection.toolMode === 'hand' || selection.spaceHeld) return;
    // Ctrl/Cmd+drag on a different station while exactly one is selected:
    // drag the target while continuously redistributing intervening stops
    // between the two. A pure click (no drag) still routes to onClick →
    // one-shot redistribute via the click handler. When multi-selected,
    // ctrl-drag yields to group-drag (no anchor captured).
    const ids = selection.selectedStationIds;
    const soloAnchor = ids.length === 1 ? ids[0] : null;
    const anchor =
      (e.ctrlKey || e.metaKey) && soloAnchor && soloAnchor !== station.id ? soloAnchor : undefined;
    onStartDrag(station.id, e, anchor);
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    // Transfer-creation flow: first click sets the anchor, second commits.
    // Capture which specific dot was closest to the click so the transfer
    // pins to that stop instead of an arbitrary station-anchor location.
    if (selection.uiMode.kind === 'creating-transfer') {
      const lineId = closestStopLineId(station, e);
      const anchor = selection.uiMode.anchor;
      if (!anchor) {
        selection.setTransferAnchor({ stationId: station.id, lineId });
        // Clear the first-pick hover highlight — the dot is now committed
        // as the anchor, no longer just hovered.
        selection.setHoveredLineStop(null);
      } else {
        // Same station + same dot is a no-op self-transfer; same station
        // + a DIFFERENT dot (interlined station) is allowed.
        const sameStation = anchor.stationId === station.id;
        const sameLine = anchor.lineId === lineId;
        if (!(sameStation && sameLine)) {
          addTransfer(anchor, { stationId: station.id, lineId });
          selection.setUiMode({ kind: 'idle' });
          selection.setHoveredLineStop(null);
        }
      }
      return;
    }
    // Ctrl/Cmd-click on a different station while exactly one is selected:
    // redistribute intervening stops on each line that connects them.
    // Multi-selection disables redistribute — group operations win.
    const selIds = selection.selectedStationIds;
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      selIds.length === 1 &&
      selIds[0] !== station.id
    ) {
      redistributeBetween(selIds[0], station.id, 'arc-bends', gridMode);
      return;
    }
    if (selection.uiMode.kind === 'creating-line-tag') {
      // "Click anywhere that isn't a valid place for line tags" exits the mode.
      selection.setUiMode({ kind: 'idle' });
      return;
    }
    if (selection.uiMode.kind === 'appending-to-line') {
      const { lineId, insertAfterIndex } = selection.uiMode;
      const ln = lines[lineId];
      const wasInLine = ln?.stations.includes(station.id) ?? false;
      // No cursor: refuse to add a new stop. Removing an existing stop is
      // still allowed since it doesn't depend on an insertion point.
      if (!wasInLine && insertAfterIndex === null) return;
      const effectiveCursor = insertAfterIndex ?? -1;
      toggleStationOnLine(lineId, station.id, effectiveCursor);
      if (!wasInLine) {
        selection.setInsertAfterIndex(effectiveCursor + 1);
      }
      return;
    }
    // Ctrl/Cmd+Shift+click on a different station extends the selection
    // along the shortest shared line from the anchor to this station,
    // toggling every station in the half-open interval (anchor, this].
    // No-op if there's no anchor (no current selection) or no shared line.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const anchor = selIds.length > 0 ? selIds[selIds.length - 1] : null;
      if (anchor && anchor !== station.id) {
        const path = pathBetweenStations({ lines }, anchor, station.id);
        if (path) selection.xorStationsToSelection(path);
      }
      return;
    }
    // Shift-click toggles membership in the multi-selection. Plain click
    // (no modifier) replaces the selection with this station.
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      selection.toggleStationSelection(station.id);
      return;
    }
    selection.selectStation(station.id);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on a station that's part of a multi-selection rotates the
    // whole group rigidly around this station (each member rotates in place AND
    // non-pivot members — bullets, labels, AND polygons — orbit 45° around the
    // pivot); otherwise it rotates just this station. Shared with the bullet/
    // label/polygon handlers so every type participates.
    rotateItemOnContextMenu({ type: 'station', id: station.id }, () => rotateStation(station.id));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selection.selectStation(station.id);
    selection.setEditingStationId(station.id);
  };

  const inTagMode = selection.uiMode.kind === 'creating-line-tag';
  const inLayerMode = selection.uiMode.kind === 'layering';
  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  const inTransferPick = selection.uiMode.kind === 'creating-transfer';
  // Layering mode disables all station interaction the same way tag mode does
  // — clicks/drags pass straight through hit areas to the underlying band
  // stripes so any pixel of a line segment is reachable, even where it sits
  // beneath a station's hitbox.
  const inHitlessMode = inTagMode || inLayerMode;
  const onTransferPointerMove = (e: React.PointerEvent) => {
    const lineId = closestStopLineId(station, e);
    if (!lineId) return;
    const anchor = selection.uiMode.kind === 'creating-transfer' ? selection.uiMode.anchor : null;
    if (anchor && anchor.stationId === station.id && anchor.lineId === lineId) {
      const cur = selection.hoveredLineStop;
      if (cur && cur.stationId === station.id) selection.setHoveredLineStop(null);
      return;
    }
    const cur = selection.hoveredLineStop;
    if (cur && cur.stationId === station.id && cur.lineId === lineId) return;
    selection.setHoveredLineStop({ stationId: station.id, lineId });
  };
  const onTransferPointerLeave = () => {
    const cur = selection.hoveredLineStop;
    if (cur && cur.stationId === station.id) selection.setHoveredLineStop(null);
  };
  const handlers = {
    onPointerDown: inHitlessMode ? undefined : onPointerDown,
    onClick: inHitlessMode || inHandMode ? undefined : onClick,
    onDoubleClick: inHitlessMode || inHandMode ? undefined : onDoubleClick,
    onContextMenu: inHitlessMode ? undefined : onContextMenu,
    onPointerMove: inTransferPick ? onTransferPointerMove : undefined,
    onPointerLeave: inTransferPick ? onTransferPointerLeave : undefined,
  };
  // Hand mode → open hand (pannable). Otherwise a movable station shows the
  // four-arrow move cursor; a locked station shows the pointing hand (it can
  // still be clicked to select/edit, just not dragged).
  const cursor = itemCursor(inHandMode, station.locked);

  return { handlers, cursor, inHitlessMode };
}
