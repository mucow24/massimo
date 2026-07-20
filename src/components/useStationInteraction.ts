import { Line, LineId, Station } from '../model/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { dispatchMirrored } from '../state/mirrorDispatch';
import { useSnapPrefs } from '../state/snapPrefs';
import { stopPosWorld } from '../geometry/interlining';
import { pairKeyOf } from '../model/pairKey';
import { pathBetweenStations } from '../model/pathSelect';
import { rotateItemOnContextMenu } from './canvas/groupRotate';
import { itemCursor } from './canvas/itemCursor';
import { screenToWorld } from './canvas/viewportMath';
import { decideStationClick, nextSegmentStyle } from './canvas/appendGestures';

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
 * Returns `hitless` — true when this station must not capture pointer events
 * (tag/layering mode pass-through, or locked-and-unselected click-through) —
 * so callers can also drop their hit rect's pointer-events, and a cursor
 * that reflects hand/pan mode.
 */
export function useStationInteraction(
  station: Station,
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void,
  lines: Record<string, Line>,
) {
  const selection = useSelection();
  const rotateStation = useDoc((s) => s.rotateStation);
  const addStationToLine = useDoc((s) => s.addStationToLine);
  const connectStationsOnLine = useDoc((s) => s.connectStationsOnLine);
  const spliceStationIntoEdge = useDoc((s) => s.spliceStationIntoEdge);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
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
      // Edit Stops: the click's meaning is decided by the pure gesture matrix
      // (appendGestures.ts) — a station cursor connects and advances, an edge
      // cursor splices and keeps marching, a null cursor arms on a member.
      const { lineId, cursor } = selection.uiMode;
      const ln = lines[lineId];
      if (!ln) return;
      const decision = decideStationClick(ln, cursor, station.id, e.shiftKey);
      switch (decision.kind) {
        case 'seed':
          addStationToLine(lineId, decision.stationId);
          selection.setAppendCursor(decision.cursor);
          break;
        case 'connect':
          connectStationsOnLine(lineId, decision.from, decision.to);
          selection.setAppendCursor(decision.cursor);
          break;
        case 'splice':
          spliceStationIntoEdge(lineId, decision.from, decision.to, decision.stationId);
          selection.setAppendCursor(decision.cursor);
          break;
        case 'cursor':
          selection.setAppendCursor(decision.cursor);
          break;
        case 'cycle-style':
          // Shift-click over the armed segment (on an endpoint station): cycle
          // its pattern, leaving the cursor armed so repeated shifts keep
          // cycling. The style edit is the whole action — no cursor change.
          setLineSegmentStyle(
            lineId,
            decision.from,
            decision.to,
            nextSegmentStyle(ln, pairKeyOf(decision.from, decision.to)),
          );
          break;
        default:
          break; // 'none' — the click means nothing right now
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
    // NOTE: right-click rotates in Edit Stops too (auto-orient often needs a
    // quick fix while laying out a line) — stop removal is the × chip or the
    // Delete key, never right-click, which sits one slip away from rotate.
    // Right-click on a station that's part of a multi-selection rotates the
    // whole group rigidly around this station (each member rotates in place AND
    // non-pivot members — bullets, labels, AND polygons — orbit 45° around the
    // pivot); otherwise it rotates just this station. Shared with the bullet/
    // label/polygon handlers so every type participates. The single rotate
    // goes through the mirror dispatch ONLY when this station is the sole
    // selection — right-click reaches ANY station, but Select Similar is
    // scoped to the selected one.
    rotateItemOnContextMenu({ type: 'station', id: station.id }, () => {
      const solo =
        selection.selectedStationIds.length === 1 && selection.selectedStationIds[0] === station.id;
      if (solo) dispatchMirrored(station.id, (sid) => rotateStation(sid));
      else rotateStation(station.id);
    });
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
  //
  // A LOCKED station is likewise hitless while it isn't part of the current
  // selection: lock means "this is background — stop catching my clicks", so
  // clicks land on whatever is beneath its (generous) hit rects. While
  // selected it stays interactive, so the popover's unlock toggle and
  // label-layout editing remain reachable right after locking.
  //
  // IDLE + LAYOUT-EDIT ONLY: non-idle modes wipe the selection on entry, so
  // without this gate a locked station would be unreachable in every mode —
  // and the pass-through click would land on a stripe or the background,
  // silently killing the mode. Lock protects geometry, not mode
  // participation: a locked station is still a transfer endpoint and can
  // still be toggled onto a line in append mode. editing-station-layout is
  // the exception among modes: there a locked station must read as
  // background again — a live hit rect would route the click to
  // selectStation, whose layoutEditReconcile RETARGETS the editor onto the
  // locked station instead of letting the click fall through and exit.
  const lockedClickThrough =
    !!station.locked &&
    (selection.uiMode.kind === 'idle' || selection.uiMode.kind === 'editing-station-layout') &&
    !selection.selectedStationIds.includes(station.id);
  // Mode pass-through strips the handlers outright; locked click-through
  // keeps them WIRED — pointer-events already blocks every real click, while
  // the alt+click deep-pick reaches locked stations by dispatching synthetic
  // clicks to these very handlers (dispatch ignores pointer-events).
  const modeInert = inTagMode || inLayerMode;
  const hitless = modeInert || lockedClickThrough;
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
  // Canvas mouseover → preview this station's selection chrome at 50%. Only in
  // idle mode (any non-idle mode owns the pointer for its own gesture; the
  // transfer-pick path below reuses onPointerLeave for its dot highlight). Wired
  // through the SAME handlers as the bg hit-rect AND the dots, so the pointer is
  // over one of the two hover targets everywhere on the footprint — crossing
  // between them fires leave-then-enter, which React batches (both continuous
  // events) into the final id, so the preview never blinks. The leave clears
  // only when THIS station is still the hovered one (fresh read, not the render-
  // time snapshot), so a fast cross to a neighbor can't wipe the neighbor.
  const inIdle = selection.uiMode.kind === 'idle';
  const onHoverEnter = () => selection.setHoveredCanvasItem({ kind: 'station', id: station.id });
  const onHoverLeave = () => {
    const h = useSelection.getState().hoveredCanvasItem;
    if (h && h.kind === 'station' && h.id === station.id) selection.setHoveredCanvasItem(null);
  };
  // Edit Stops mouseover: mark this station as the append hover target so
  // HighlightedLineLayer previews the ring a click would place (gated there by
  // the click matrix). The SAME footprint hit surfaces as the idle hover — the
  // pointer is over one of them everywhere on the station — so "what I hover" is
  // "what I'd click." The leave clears only when THIS station is still the
  // target (fresh read), so a fast cross to a neighbor can't wipe it.
  const inAppend = selection.uiMode.kind === 'appending-to-line';
  const onAppendHoverEnter = () =>
    selection.setAppendHover({ kind: 'station', stationId: station.id });
  const onAppendHoverLeave = () => {
    const h = useSelection.getState().appendHover;
    if (h?.kind === 'station' && h.stationId === station.id) selection.setAppendHover(null);
  };
  const handlers = {
    onPointerDown: modeInert ? undefined : onPointerDown,
    onClick: modeInert || inHandMode ? undefined : onClick,
    onDoubleClick: modeInert || inHandMode ? undefined : onDoubleClick,
    onContextMenu: modeInert ? undefined : onContextMenu,
    onPointerEnter: inIdle ? onHoverEnter : inAppend ? onAppendHoverEnter : undefined,
    onPointerMove: inTransferPick ? onTransferPointerMove : undefined,
    onPointerLeave: inTransferPick
      ? onTransferPointerLeave
      : inIdle
        ? onHoverLeave
        : inAppend
          ? onAppendHoverLeave
          : undefined,
  };
  // Hand mode → open hand (pannable). Otherwise a movable station shows the
  // four-arrow move cursor; a locked station shows the pointing hand. The
  // pointer only ever shows while the locked station is SELECTED (unselected
  // locked stations are click-through, so nothing hovers them) — where it
  // reads as "clickable to keep the popover/unlock reachable, not draggable".
  const cursor = itemCursor(inHandMode, station.locked);

  return { handlers, cursor, hitless };
}
