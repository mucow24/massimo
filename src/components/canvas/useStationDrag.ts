import { RefObject, useCallback, useRef } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import type { StationId } from '../../model/types';
import { Rotation } from '../../geometry/orientation';
import { snapDraggedStation, SnapGuide, snapToleranceAt } from '../../geometry/snap';
import { useRoutedSnapGuides } from './useRoutedSnapGuides';
import { lineCircleAtPoint, snapPointToCircle, stationCircle } from '../../geometry/lineCircle';
import { liveCaptureCircles } from './snapTargets';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  emptyGroupSiblings,
  hasGroupSiblings,
  movingStationIds,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';

export interface StationDragApi {
  snapGuides: SnapGuide[];
  onStartDrag: (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Owns station-drag state: tracks the in-flight drag, runs the snap engine,
 * and commits position updates via `moveStation`. Returns the active snap
 * guides for rendering plus the pointer handlers to wire onto the SVG.
 *
 * The drag lifecycle (move threshold, pointer capture, click suppression,
 * one-history-entry-per-gesture) and the group-drag sibling towing are shared
 * with the other drag hooks via dragGesture + groupDrag.
 */
// How far past a circle's rim (as a multiple of the capture tolerance) a
// bound station may be pulled before it pops OFF the ring: within the band
// the drag slides along the circle; beyond it the station detaches and
// follows the cursor. The asymmetry (capture at 1×, release at 3×) is the
// escape hysteresis — snapping ON is as easy as any other snap, staying ON
// is deliberately stickier.
const CIRCLE_RELEASE_FACTOR = 3;

export function useStationDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): StationDragApi {
  // No reactive subscriptions to the towed collections here — they change on
  // EVERY pointermove, and a subscription would re-run MapCanvas (this hook's
  // host) per input event while the pipeline's render source is frozen, which
  // is precisely the no-op render tax the freeze exists to eliminate. The
  // handlers ask the store at event time instead (which is also fresher: a
  // closure would be one render stale). Actions are stable references, so
  // subscribing to them never re-renders.
  const moveStation = useDoc((s) => s.moveStation);
  const bindStationToCircle = useDoc((s) => s.bindStationToCircle);
  const unbindStationFromCircle = useDoc((s) => s.unbindStationFromCircle);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridSize = useViewportStore((s) => s.gridSize);

  const dragStationRef = useRef<{
    id: StationId;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    redistributeAnchor: StationId | null;
    // Other selected items (every type) towed by the grabbed station's delta.
    siblings: GroupSiblings;
    // Station-sibling ids excluded from the snap engine's candidate set — they
    // move with the grab, so they're unstable targets.
    siblingIdSet: ReadonlySet<StationId>;
    // The seat a bound station was last pulled OFF, kept for the rest of the
    // gesture. A detached station keeps its cells but carries the rotation of
    // that seat, so re-capturing the ring needs the pose those cells were
    // authored in to land where the unbroken slide would have — see
    // `bindStationToCircle`. Null until the ring lets go.
    escapedFrom: { circleId: string; x: number; y: number; rotation: Rotation } | null;
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useRoutedSnapGuides('station');

  // onStartDrag is passed to every (memoized) StationView; keep it referentially
  // stable so a pan/zoom — or any unrelated edit — doesn't re-render every
  // station. It reads the live station map at call time.
  const onStartDrag = useCallback(
    (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => {
      const st = useDoc.getState().stations[id];
      if (!st) return;
      // A locked station can't be dragged. Bail without capturing a gesture;
      // the pointerdown still bubbles to the canvas (the station's handler
      // never stops propagation), so a drag over it begins a marquee instead.
      if (st.locked) return;
      // Group-drag: tow the rest of the multi-selection (every type) by the same
      // delta. Suppressed when a redistribute anchor is present — that only
      // happens when exactly one OTHER station is selected, so the grabbed
      // (unselected) station tows nothing anyway; empty either way. Snap runs on
      // the grabbed station only; siblings translate.
      const siblings = redistributeAnchor
        ? emptyGroupSiblings()
        : collectGroupSiblings('station', id);
      dragStationRef.current = {
        id,
        startWX: st.x,
        startWY: st.y,
        startMX: e.clientX,
        startMY: e.clientY,
        moved: false,
        redistributeAnchor: redistributeAnchor ?? null,
        siblings,
        siblingIdSet: movingStationIds(siblings),
        escapedFrom: null,
        // Snapshot the doc + pause history; commit one entry on drag, cancel on a
        // pure click. Pointer capture is deferred to first movement (trackDragMove)
        // so the synthesized click still lands on the station's rect.
        history: beginHistoryGroup({ deferPersist: true }),
      };
    },
    [],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragStationRef.current;
    if (!ds) return;
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move.
    if (pointerLost(e)) return onPointerCancel();
    const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    // Event-time reads (see the note at the top: no reactive subscriptions).
    const { stations, lines, lineCircles } = useDoc.getState();
    const dx = dxScreen / viewportZoom;
    const dy = dyScreen / viewportZoom;
    let nx = ds.startWX + dx;
    let ny = ds.startWY + dy;
    const draggedSt = stations[ds.id];
    const draggedRot = (draggedSt?.rotation ?? 0) as Rotation;
    const draggedStops = draggedSt?.stops ?? [];
    // Redistribute mode is toggled LIVE by Ctrl/Cmd, re-read every move: the
    // anchor was captured at pointer-down, but whether we redistribute follows
    // the modifier held right now, so pressing or releasing Ctrl mid-drag
    // switches between plain drag and even-spacing between anchor and grab.
    const redistributeAnchor = e.ctrlKey || e.metaKey ? ds.redistributeAnchor : null;
    // Snap is on by default; Shift bypasses it.
    const shouldSnap = !e.shiftKey;
    // A bound station whose own RING is towed with it (both co-selected). The
    // ring travels with the station, so there is no constraint left to enforce:
    // the drag is a plain translation of the whole assembly. The station's
    // position comes ENTIRELY from `moveLineCircle` carrying it (below) — writing
    // it directly as well would reseat it on the ring's not-yet-moved center and
    // slide it round the rim as you drag. Neither the slide nor the Shift/
    // out-of-band detach applies: you asked to move the ring too.
    const ringTowed =
      draggedSt?.circleId !== undefined &&
      ds.siblings.lineCircles.some((c) => c.id === draggedSt.circleId);
    // Line-circle binding (skipped during a redistribute — that modal gesture
    // owns its own constraint). A BOUND station slides along its circle while
    // the cursor stays within the release band, and detaches when pulled past
    // it (or instantly on Shift — "Shift bypasses all snapping"). A FREE
    // station carried within capture tolerance of a rim binds onto it —
    // projection, tangent rotation and the viaCircle stop defaults all live
    // in the transforms; everything here is just the capture/release call.
    if (!redistributeAnchor && !ringTowed) {
      const tolerance = snapToleranceAt(viewportZoom);
      const circle = draggedSt ? stationCircle(draggedSt, lineCircles) : null;
      // "Snap to circle cardinals" adds angular magnetism to the seat, measured
      // as arc length against the same tolerance as the capture. Null = rim only.
      const cardinalTolerance = snapModes.circle ? tolerance : null;
      const moveConstrained = (c: { x: number; y: number; radius: number }) => {
        // ONE point for both the master and the tow: `moveStation` reprojects
        // whatever it is handed (idempotent on an already-seated point), so
        // passing the seat rather than the raw cursor keeps a group drag from
        // shearing by however far the cardinal pull moved the master.
        const p = snapPointToCircle(c, { x: nx, y: ny }, cardinalTolerance);
        moveStation(ds.id, p.x, p.y);
        if (hasGroupSiblings(ds.siblings)) {
          translateSiblings(ds.siblings, p.x - ds.startWX, p.y - ds.startWY);
        }
        // Unconditional: while the pipeline is armed, local state is frozen
        // and can't be trusted as a guard — a guarded clear would be skipped
        // and the last routed guides would keep painting (the setter's
        // equality bail preserves the at-rest no-re-render property).
        setSnapGuides([]);
      };
      // Remember the seat as the ring lets go: a straight cursor path across a
      // wide arc dips out of the release band partway and comes back, and that
      // round trip must leave the layout exactly where sliding would have.
      const release = () => {
        if (draggedSt && circle) {
          ds.escapedFrom = {
            circleId: circle.id,
            x: draggedSt.x,
            y: draggedSt.y,
            rotation: draggedRot,
          };
        }
        unbindStationFromCircle(ds.id);
      };
      if (circle && !shouldSnap) {
        release();
      } else if (circle) {
        const rimDist = Math.abs(Math.hypot(nx - circle.x, ny - circle.y) - circle.radius);
        if (rimDist <= tolerance * CIRCLE_RELEASE_FACTOR) return moveConstrained(circle);
        release();
      } else if (shouldSnap) {
        // liveCaptureCircles, not the raw record: a ring the View menu is
        // hiding must not capture — and BIND — a station dragged past it.
        const captured = lineCircleAtPoint(
          liveCaptureCircles(lineCircles),
          { x: nx, y: ny },
          tolerance,
        );
        if (captured) {
          const escaped = ds.escapedFrom;
          bindStationToCircle(
            ds.id,
            captured.id,
            escaped?.circleId === captured.id ? escaped : undefined,
          );
          return moveConstrained(captured);
        }
      }
    }
    if (shouldSnap) {
      const snap = snapDraggedStation({
        draggedId: ds.id,
        proposedX: nx,
        proposedY: ny,
        draggedRotation: draggedRot,
        draggedStops,
        stations,
        lines,
        lineCircles,
        tolerance: snapToleranceAt(viewportZoom),
        // Ctrl-drag: snap exclusively to the anchor (the originally selected
        // station). Intermediates are moving with the redistribute.
        redistributeAnchor: redistributeAnchor ?? undefined,
        // Group-drag: siblings move with the grab, so exclude them as targets.
        excludedIds: ds.siblingIdSet.size > 0 ? ds.siblingIdSet : undefined,
        modes: snapModes,
        gridInterval: gridSize,
      });
      nx = snap.x;
      ny = snap.y;
      // The routed setter keeps the previous array when this move reproduced
      // it (including the no-guides case) so React bails on the same-reference
      // state instead of re-rendering for a value-identical fresh array.
      setSnapGuides(snap.guides);
    } else {
      // Unconditional for the same reason as moveConstrained's clear: frozen
      // local state can't gate a clear while the pipeline is armed.
      setSnapGuides([]);
    }
    if (!ringTowed) moveStation(ds.id, nx, ny);
    if (hasGroupSiblings(ds.siblings)) {
      translateSiblings(ds.siblings, nx - ds.startWX, ny - ds.startWY);
    }
    if (redistributeAnchor) {
      // Drag-mode redistribute uses straight-line interpolation between A and
      // B's stop positions so spacing stays predictable and intermediates don't
      // wobble off-axis. Hard-grid applies to intermediates too (Shift bypasses).
      redistributeBetween(
        redistributeAnchor,
        ds.id,
        'straight',
        shouldSnap ? snapModes.grid : 'off',
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragStationRef.current;
    if (!ds) return;
    dragStationRef.current = null;
    // Clear AFTER the exit: finishDrag's commit drains the pipeline, and a
    // clear issued while still armed would be routed away with the gesture.
    finishDrag(ds, e, svgRef);
    setSnapGuides([]);
  };

  // A browser pointercancel (pen palm rejection, window switch, capture loss)
  // aborts the gesture: disarm the ref (so the next stray move can't resume a
  // button-less drag), drop the guides, and roll the doc back to the pre-drag
  // snapshot — reverting the live moveStation writes (and any towed siblings)
  // without committing a drop.
  const onPointerCancel = () => {
    const ds = dragStationRef.current;
    if (!ds) return;
    dragStationRef.current = null;
    // Rollback first: it drains the pipeline, so the clear lands in hook
    // state instead of being routed away (see useRoutedSnapGuides).
    ds.history.rollback();
    setSnapGuides([]);
  };

  return { snapGuides, onStartDrag, onPointerMove, onPointerUp, onPointerCancel };
}
