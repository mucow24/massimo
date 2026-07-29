import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import type { StationId } from '../../model/types';
import { Rotation } from '../../geometry/orientation';
import {
  snapDraggedStation,
  SnapGuide,
  snapGuidesEqual,
  snapToleranceAt,
} from '../../geometry/snap';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  emptyGroupSiblings,
  hasGroupSiblings,
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
export function useStationDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): StationDragApi {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const moveStation = useDoc((s) => s.moveStation);
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
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // onStartDrag is passed to every (memoized) StationView; keep it referentially
  // stable so a pan/zoom — or any unrelated edit — doesn't re-render every
  // station. Read the live station map through a ref instead of closing over it.
  const stationsRef = useRef(stations);
  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  const onStartDrag = useCallback(
    (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => {
      const st = stationsRef.current[id];
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
        siblingIdSet: new Set(siblings.stations.map((s) => s.id)),
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
    if (shouldSnap) {
      const snap = snapDraggedStation({
        draggedId: ds.id,
        proposedX: nx,
        proposedY: ny,
        draggedRotation: draggedRot,
        draggedStops,
        stations,
        lines,
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
      // Keep the previous array when this move reproduced it (including the
      // no-guides case) so React bails on the same-reference state instead of
      // re-rendering for a value-identical fresh array every move.
      setSnapGuides((prev) => (snapGuidesEqual(prev, snap.guides) ? prev : snap.guides));
    } else if (snapGuides.length > 0) {
      setSnapGuides([]);
    }
    moveStation(ds.id, nx, ny);
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
    setSnapGuides([]);
    finishDrag(ds, e, svgRef);
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
    setSnapGuides([]);
    ds.history.rollback();
  };

  return { snapGuides, onStartDrag, onPointerMove, onPointerUp, onPointerCancel };
}
