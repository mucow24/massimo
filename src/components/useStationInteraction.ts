import { Line, LineId, Station } from '../model/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { pickTransferEnd } from '../state/transferPick';
import { isStopEnd } from '../model/transferAnchors';
import { dispatchMirrored } from '../state/mirrorDispatch';
import { useSnapPrefs } from '../state/snapPrefs';
import { stopPosWorld } from '../geometry/interlining';
import { pairKeyOf } from '../model/pairKey';
import { pathBetweenStations } from '../model/pathSelect';
import { incidentEdges } from '../model/lineTopology';
import { rotateItemOnContextMenu } from './canvas/groupRotate';
import { itemCursor } from './canvas/itemCursor';
import { screenToWorld } from './canvas/viewportMath';
import { getCanvasSvg } from '../export/exportCanvas';
import { appendStationCursor, decideStationClick, nextSegmentStyle } from '../model/appendGestures';

// Map a click on a station to the closest dot's lineId. Used to pin a
// transfer endpoint to the specific stop the user clicked on, rather than
// the station's anchor center.
function closestStopLineId(
  station: Station,
  e: React.MouseEvent,
  lineCircles: Record<string, import('../model/types').LineCircle>,
): LineId | null {
  if (station.stops.length === 0) return null;
  // getCanvasSvg, not a hand-rolled selector: the item popovers live inside
  // .canvas-host too and carry their own little icon <svg>s, so "the first svg
  // under the host" names the map surface only by DOM luck. One owner also
  // keeps this on the right element as the shell changes — the pan layer moved
  // the map svg a level deeper (see useViewport).
  const svg = getCanvasSvg();
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
    const { x: sx, y: sy } = stopPosWorld(cell, station, lineCircles);
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
  // No reactive lineCircles subscription: this hook is mounted once per
  // station hit area (~one per station), and a ring or ring-towed group drag
  // writes lineCircles per pointermove — a subscription would re-render every
  // hit area at input cadence while the pipeline's render source is frozen.
  // The two click-time consumers read the store at event time instead.
  const rotateStation = useDoc((s) => s.rotateStation);
  const addStationToLine = useDoc((s) => s.addStationToLine);
  const connectStationsOnLine = useDoc((s) => s.connectStationsOnLine);
  const spliceStationIntoEdge = useDoc((s) => s.spliceStationIntoEdge);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const gridMode = useSnapPrefs((s) => s.modes.grid);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // In hand mode, let the event bubble to the SVG so it becomes a pan.
    if (selection.toolMode === 'hand' || selection.spaceHeld) return;
    // Drag on a different station while exactly one is selected: capture that
    // selected station as the redistribute anchor. Capture it whether or not
    // Ctrl is held right now — useStationDrag re-reads the live Ctrl/Cmd state
    // on every move to decide whether redistribute is active, so pressing or
    // releasing Ctrl mid-drag switches between plain drag and continuously
    // redistributing intervening stops between the two. Without the anchor
    // captured up front, a Ctrl press mid-drag would have nothing to engage.
    // A pure click (no drag) still routes to onClick → one-shot redistribute
    // via the click handler. When multi-selected, drag yields to group-drag
    // (no solo anchor).
    const ids = selection.selectedStationIds;
    const soloAnchor = ids.length === 1 ? ids[0] : null;
    const anchor = soloAnchor && soloAnchor !== station.id ? soloAnchor : undefined;
    onStartDrag(station.id, e, anchor);
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    // Transfer-creation flow: first click sets the anchor, second commits.
    // Capture which specific dot was closest to the click so the transfer
    // pins to that stop instead of an arbitrary station-anchor location.
    if (selection.uiMode.kind === 'creating-transfer') {
      // The two-click contract lives in pickTransferEnd, shared with the anchor
      // layer — same station + same dot is still an inert self-transfer, same
      // station + a DIFFERENT dot (interlined) is still allowed, and both rules
      // now come from one place.
      pickTransferEnd({
        stationId: station.id,
        lineId: closestStopLineId(station, e, useDoc.getState().lineCircles),
      });
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
    // Shift-click toggles membership in the multi-selection — except for the
    // SECOND click of a shift double-click, which opens the inline rename
    // editor (and re-selects this station alone, undoing the first click's
    // toggle). The gesture is counted here, off the browser's own click count
    // (`detail`), rather than off a dblclick handler: the first click flips this
    // station's selection, which mounts or unmounts its top-z drag proxy, so the
    // two clicks land on DIFFERENT elements and the native dblclick is
    // dispatched at a node that is no longer in the document. Rename by
    // dblclick was unreachable that way.
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      if (e.detail >= 2) {
        selection.selectStation(station.id);
        selection.setEditingStationId(station.id);
        return;
      }
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

  // Double-click opens the station's layout editor — the thing you actually
  // want off a station most of the time, and the same hop Edit Stops makes.
  // Renaming is the SHIFT variant, but it is handled on the click path (see
  // onClick) because a shift double-click's native dblclick often never lands;
  // all this one owes it is to stay out of the way. Plain double-click is
  // reliable by comparison: both of its clicks leave the station sole-selected,
  // so the proxy the second click hits is still mounted when dblclick fires.
  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) return;
    selection.startEditingStationLayout(station.id);
  };

  // Edit Stops' own double-click: hop from "where does this line stop" to
  // "how does this station lay its stops out", for a station already ON the
  // line. The same destination as the idle double-click, but unconditional —
  // shift is spoken for in the mode (it cycles a segment's style), so there is
  // no rename gesture here; renaming mid-mode would null selectedLineId while
  // appending-to-line stayed armed.
  //
  // The two clicks underneath still run the append gesture, so a pen armed
  // elsewhere CONNECTS to this station before the hop lands. That's the click
  // matrix doing exactly what a single click there means, and it stays undoable
  // (Ctrl+Z) — the alternative, a gesture that silently no-ops depending on
  // invisible cursor state, is worse.
  const onAppendDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selection.startEditingStationLayout(station.id);
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
  // Edit Stops: a station whose click means NOTHING goes hitless, so the click
  // falls through to the line beneath — clicking a foreign line there switches
  // the editor to it — and so it stops catching hover. "Means nothing" is not
  // re-derived here: it is exactly the click matrix's 'none', asked of the same
  // decideStationClick the onClick handler dispatches on, so the hit surface and
  // the click can never disagree about which stations are dead. (That case is a
  // NON-empty line + no valid cursor + a non-member: an empty line seeds on any
  // click, an armed cursor connects/splices onto foreign stations, and a member
  // click always arms the pen.)
  // ...but ONLY where a stripe is actually painted beneath to catch the click.
  // The fall-through IS the feature; with nothing under the station the click
  // reaches MapCanvas's full-viewport background rect instead, which reads as
  // "clicked empty canvas" and EXITS the editor. Losing the whole session by
  // aiming at a station you can see is a harsh price for a dead click, so an
  // orphan station (no line through it) keeps its hit rect and swallows it —
  // decideStationClick already makes that handler a no-op.
  const appendMode = selection.uiMode.kind === 'appending-to-line' ? selection.uiMode : null;
  const appendLine = appendMode ? lines[appendMode.lineId] : undefined;
  const hasStripeBeneath = station.stops.some((c) => {
    const ln = lines[c.lineId];
    return !!ln && incidentEdges(ln, station.id).length > 0;
  });
  const appendForeignInert =
    !!appendMode &&
    !!appendLine &&
    hasStripeBeneath &&
    decideStationClick(appendLine, appendMode.cursor, station.id).kind === 'none';
  // A station already ON the edited line — the only kind with a stop of this
  // line to lay out, so the only one the mode's double-click hands off to.
  const appendMember = !!appendLine && appendLine.stations.includes(station.id);
  const modeInert = inTagMode || inLayerMode;
  const hitless = modeInert || lockedClickThrough || appendForeignInert;
  const onTransferPointerMove = (e: React.PointerEvent) => {
    const lineId = closestStopLineId(station, e, useDoc.getState().lineCircles);
    if (!lineId) return;
    const first = selection.uiMode.kind === 'creating-transfer' ? selection.uiMode.firstEnd : null;
    if (first && isStopEnd(first) && first.stationId === station.id && first.lineId === lineId) {
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
  // In Edit Stops a member hops to the layout editor and a foreign station has
  // no double-click at all; everywhere else it's the layout editor (rename on
  // shift).
  const dblClickForMode = inAppend
    ? appendMember
      ? onAppendDoubleClick
      : undefined
    : onDoubleClick;
  const handlers = {
    // Edit Stops is line construction, not station placement: drag and
    // right-click rotate are unwired there. A few pixels of wobble during a
    // rapid connect-click used to both move the station AND suppress the
    // click (dragState.suppressClick) — the connect silently died. With no
    // contextmenu handler the right-click bubbles to the MapCanvas root,
    // where it exits the mode; to move or rotate a station, exit first.
    onPointerDown: modeInert || inAppend ? undefined : onPointerDown,
    onClick: modeInert || inHandMode ? undefined : onClick,
    // Both double-clicks land in the layout editor; they differ in what else
    // they allow. Edit Stops uses its own (members only — see
    // onAppendDoubleClick) because the idle one's shift branch must NOT run in
    // the mode: its selectStation spreads clearedSelections(), which would null
    // selectedLineId while the mode stays armed — highlight and dim wash gone,
    // invisible line still routing station clicks to connect/splice.
    onDoubleClick: modeInert || inHandMode ? undefined : dblClickForMode,
    onContextMenu: modeInert || inAppend ? undefined : onContextMenu,
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
  // Hand mode → open hand (pannable). Edit Stops → the click-matrix cursor
  // (copy/pointer/default, see appendStationCursor — 'move' never shows since
  // stations don't drag in the mode). Otherwise a movable station shows the
  // four-arrow move cursor; a locked station shows the pointing hand. The
  // pointer only ever shows while the locked station is SELECTED (unselected
  // locked stations are click-through, so nothing hovers them) — where it
  // reads as "clickable to keep the popover/unlock reachable, not draggable".
  const cursor =
    !inHandMode && appendMode && appendLine
      ? appendStationCursor(appendLine, appendMode.cursor, station.id)
      : itemCursor(inHandMode, station.locked);

  return { handlers, cursor, hitless };
}
