import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import type { StationId } from '../../model/types';
import { Rotation } from '../../geometry/orientation';
import { snapDraggedStation, SnapGuide, SNAP_PERP_TOLERANCE } from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';

export interface StationDragApi {
  snapGuides: SnapGuide[];
  onStartDrag: (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Owns station-drag state: tracks the in-flight drag, runs the snap engine,
 * and commits position updates via `moveStation`. Returns the active snap
 * guides for rendering plus the pointer handlers to wire onto the SVG.
 *
 * The handlers are drag-only; pan handling lives in `useViewport`. The shell
 * composes both onto each pointer event.
 */
export function useStationDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): StationDragApi {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const moveStation = useDoc((s) => s.moveStation);
  const moveRouteBullet = useDoc((s) => s.moveRouteBullet);
  const moveTextLabel = useDoc((s) => s.moveTextLabel);
  const setPolygonVertices = useDoc((s) => s.setPolygonVertices);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const snapModes = useSnapPrefs((s) => s.modes);

  const dragStationRef = useRef<{
    id: StationId;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    redistributeAnchor: StationId | null;
    // Other selected stations to drag with the grabbed one (group drag).
    // Each is paired with its starting world position so per-frame deltas
    // are computed against a stable origin even if the dragged station's
    // position is mid-snap.
    siblings: { id: StationId; startX: number; startY: number }[];
    siblingIdSet: ReadonlySet<StationId>;
    // Selected route bullets that tag along with the group drag. Same
    // delta as the grabbed station; no snap targets, no participation in
    // the snap engine's candidate set.
    bulletSiblings: { id: string; startX: number; startY: number }[];
    // Selected text labels that tag along. Same delta; labels never snap
    // when towed by a station.
    labelSiblings: { id: string; startX: number; startY: number }[];
    // Selected polygons that tag along. Each carries its full start vertex
    // list so the same delta translates every vertex.
    polygonSiblings: { id: string; startVerts: Vec2[] }[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  const onStartDrag = (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => {
    const st = stations[id];
    if (!st) return;
    // Group-drag: if the grabbed station is part of a multi-selection AND
    // the user isn't ctrl-dragging (which keeps redistribute behavior),
    // every other selected station tags along with the same delta. Snap
    // operates on the grabbed station only; siblings translate.
    const sel = useSelection.getState();
    const ids = sel.selectedStationIds;
    const groupDrag = !redistributeAnchor && ids.length > 1 && ids.includes(id);
    const siblings: { id: StationId; startX: number; startY: number }[] = [];
    if (groupDrag) {
      for (const sid of ids) {
        if (sid === id) continue;
        const sst = stations[sid];
        if (!sst) continue;
        siblings.push({ id: sid, startX: sst.x, startY: sst.y });
      }
    }
    // Bullets and labels that are part of the same multi-selection: travel
    // along. The grabbed station only needs to be in `selectedStationIds`
    // for them to tag along — a single station selection plus other
    // selected items is the natural "drag everything as one group" gesture.
    const bulletSiblings: { id: string; startX: number; startY: number }[] = [];
    const labelSiblings: { id: string; startX: number; startY: number }[] = [];
    const polygonSiblings: { id: string; startVerts: Vec2[] }[] = [];
    const includesGrabbed = ids.includes(id);
    if (!redistributeAnchor && includesGrabbed) {
      if (sel.selectedRouteBulletIds.length > 0) {
        const docBullets = useDoc.getState().routeBullets;
        for (const bid of sel.selectedRouteBulletIds) {
          const b = docBullets[bid];
          if (!b) continue;
          bulletSiblings.push({ id: bid, startX: b.x, startY: b.y });
        }
      }
      if (sel.selectedLabelIds.length > 0) {
        const docLabels = useDoc.getState().textLabels;
        for (const lid of sel.selectedLabelIds) {
          const lb = docLabels[lid];
          if (!lb) continue;
          labelSiblings.push({ id: lid, startX: lb.x, startY: lb.y });
        }
      }
      if (sel.selectedPolygonIds.length > 0) {
        const docPolygons = useDoc.getState().polygons;
        for (const pid of sel.selectedPolygonIds) {
          const pg = docPolygons[pid];
          if (!pg || pg.locked) continue;
          polygonSiblings.push({ id: pid, startVerts: pg.vertices.map((v) => ({ ...v })) });
        }
      }
    }
    dragStationRef.current = {
      id,
      startWX: st.x,
      startWY: st.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      redistributeAnchor: redistributeAnchor ?? null,
      siblings,
      siblingIdSet: new Set(siblings.map((s) => s.id)),
      bulletSiblings,
      labelSiblings,
      polygonSiblings,
      // Snapshot the doc and pause history. If the gesture turns out to be
      // a drag, we'll commit one entry on pointerup; if it's just a click,
      // we cancel without recording anything.
      history: beginHistoryGroup(),
    };
    // Don't capture the pointer here — capture would redirect the synthesized
    // click event away from the station's rect to the SVG, breaking onClick.
    // We capture below on first significant movement (in onPointerMove) instead.
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStationRef.current) return;
    const ds = dragStationRef.current;
    const dxScreen = e.clientX - ds.startMX;
    const dyScreen = e.clientY - ds.startMY;
    // Use a screen-space threshold so it's forgiving regardless of zoom.
    if (!ds.moved && Math.hypot(dxScreen, dyScreen) > 4) {
      ds.moved = true;
      dragState.suppressClick = true;
      // Capture the pointer now that we're sure it's a drag, so the user can
      // slide off the station/SVG without losing it.
      svgRef.current?.setPointerCapture(e.pointerId);
    }
    if (!ds.moved) return;
    const dx = dxScreen / viewportZoom;
    const dy = dyScreen / viewportZoom;
    let nx = ds.startWX + dx;
    let ny = ds.startWY + dy;
    const draggedSt = stations[ds.id];
    const draggedRot = (draggedSt?.rotation ?? 0) as Rotation;
    const draggedStops = draggedSt?.stops ?? [];
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
        tolerance: SNAP_PERP_TOLERANCE,
        // Ctrl-drag: snap exclusively to the anchor (the originally
        // selected station). Intermediates are moving with the
        // redistribute and would be unstable snap targets.
        redistributeAnchor: ds.redistributeAnchor ?? undefined,
        // Group-drag: every sibling is moving with the grabbed station, so
        // they're not stable snap targets — exclude them.
        excludedIds: ds.siblingIdSet.size > 0 ? ds.siblingIdSet : undefined,
        modes: snapModes,
      });
      nx = snap.x;
      ny = snap.y;
      setSnapGuides(snap.guides);
    } else if (snapGuides.length > 0) {
      setSnapGuides([]);
    }
    moveStation(ds.id, nx, ny);
    // Group-drag: apply the same delta to every selected sibling — station
    // siblings, bullet siblings, and label siblings.
    if (
      ds.siblings.length > 0 ||
      ds.bulletSiblings.length > 0 ||
      ds.labelSiblings.length > 0 ||
      ds.polygonSiblings.length > 0
    ) {
      const deltaX = nx - ds.startWX;
      const deltaY = ny - ds.startWY;
      for (const sib of ds.siblings) {
        moveStation(sib.id, sib.startX + deltaX, sib.startY + deltaY);
      }
      for (const bs of ds.bulletSiblings) {
        moveRouteBullet(bs.id, bs.startX + deltaX, bs.startY + deltaY);
      }
      for (const ls of ds.labelSiblings) {
        moveTextLabel(ls.id, ls.startX + deltaX, ls.startY + deltaY);
      }
      for (const ps of ds.polygonSiblings) {
        setPolygonVertices(
          ps.id,
          ps.startVerts.map((v) => ({ x: v.x + deltaX, y: v.y + deltaY })),
        );
      }
    }
    if (ds.redistributeAnchor) {
      // Drag-mode redistribute uses straight-line interpolation between A
      // and B's stop positions so spacing stays predictable and intermediates
      // don't wobble off-axis as the polyline reshapes each frame.
      redistributeBetween(ds.redistributeAnchor, ds.id, 'straight');
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStationRef.current) return;
    const ds = dragStationRef.current;
    const wasMoved = ds.moved;
    dragStationRef.current = null;
    setSnapGuides([]);
    if (!wasMoved) {
      // Pure click — no drag happened. Discard the captured snapshot.
      ds.history.cancel();
      return;
    }
    // Drag actually happened: push a single history entry covering the
    // full sequence of moveStation updates.
    ds.history.commit();
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may not have been captured if release happened too early
    }
    // Suppress the click that fires after pointerup.
    setTimeout(() => {
      dragState.suppressClick = false;
    }, 0);
  };

  return { snapGuides, onStartDrag, onPointerMove, onPointerUp };
}
