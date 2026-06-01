import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { stopPosWorld } from '../../geometry/interlining';
import type { SnapGuide } from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';
import type { MapDoc, Station } from '../../model/types';

// Whole-polygon drag: snapshot every vertex at pointer-down; each move snaps the
// highest-then-leftmost vertex and translates the whole shape by that delta.
// Group siblings (other selected polygons / stations / bullets / labels) tow by
// the same delta.
type WholeDragState = {
  id: string;
  startVerts: Vec2[];
  startMX: number;
  startMY: number;
  moved: boolean;
  polygonSiblings: { id: string; startVerts: Vec2[] }[];
  stationSiblings: { id: string; startX: number; startY: number }[];
  bulletSiblings: { id: string; startX: number; startY: number }[];
  labelSiblings: { id: string; startX: number; startY: number }[];
  history: ReturnType<typeof beginHistoryGroup>;
};

// Single-vertex drag: snap the dragged vertex itself.
type VertexDragState = {
  polygonId: string;
  index: number;
  startVert: Vec2;
  startMX: number;
  startMY: number;
  moved: boolean;
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface PolygonDragApi {
  polygonSnapGuides: SnapGuide[];
  onPolygonPointerDown: (id: string, e: React.PointerEvent) => void;
  onVertexPointerDown: (polygonId: string, index: number, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

// Every station's stop-centers (its anchor when it has no stops). These are the
// "Snap to all" targets that represent stations.
function stationStopCenters(stations: Record<string, Station>): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    if (st.stops.length === 0) {
      out.push({ x: st.x, y: st.y });
      continue;
    }
    for (const c of st.stops) out.push(stopPosWorld(c, st));
  }
  return out;
}

// All polygon vertices except the entire polygon `excludeId` (whole-drag).
function otherPolygonVertices(polygons: MapDoc['polygons'], excludeId: string): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(polygons)) {
    if (id === excludeId) continue;
    for (const v of polygons[id].vertices) out.push(v);
  }
  return out;
}

// All polygon vertices except the single dragged vertex (vertex-drag) — so the
// dragged vertex can still snap to its own polygon's other vertices.
function polygonVerticesExceptVertex(
  polygons: MapDoc['polygons'],
  polyId: string,
  index: number,
): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(polygons)) {
    polygons[id].vertices.forEach((v, i) => {
      if (id === polyId && i === index) return;
      out.push(v);
    });
  }
  return out;
}

/**
 * Owns drag state for polygons: whole-shape moves and single-vertex edits.
 * Mirrors {@link useItemDrag} — 4px move threshold, one history entry per
 * gesture, pointer capture, click suppression — but routes snapping through
 * {@link snapPolygonPoint} so "Snap to line" aligns to the current polygon's
 * own vertices and "Snap to all" aligns to stations + every polygon vertex.
 */
export function usePolygonDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  inHandMode: boolean,
): PolygonDragApi {
  const setPolygonVertices = useDoc((s) => s.setPolygonVertices);
  const moveVertex = useDoc((s) => s.moveVertex);
  const snapModes = useSnapPrefs((s) => s.modes);

  const wholeDragRef = useRef<WholeDragState | null>(null);
  const vertexDragRef = useRef<VertexDragState | null>(null);
  const [polygonSnapGuides, setPolygonSnapGuides] = useState<SnapGuide[]>([]);

  const onPolygonPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const doc = useDoc.getState();
    const poly = doc.polygons[id];
    if (!poly) return;
    e.stopPropagation();
    // Group-drag: if the grabbed polygon is part of the multi-selection, every
    // other selected item tags along by the same per-frame delta.
    const sel = useSelection.getState();
    const includesGrabbed = sel.selectedPolygonIds.includes(id);
    const polygonSiblings: { id: string; startVerts: Vec2[] }[] = [];
    const stationSiblings: { id: string; startX: number; startY: number }[] = [];
    const bulletSiblings: { id: string; startX: number; startY: number }[] = [];
    const labelSiblings: { id: string; startX: number; startY: number }[] = [];
    if (includesGrabbed) {
      for (const pid of sel.selectedPolygonIds) {
        if (pid === id) continue;
        const p = doc.polygons[pid];
        if (!p) continue;
        polygonSiblings.push({ id: pid, startVerts: p.vertices.map((v) => ({ ...v })) });
      }
      for (const sid of sel.selectedStationIds) {
        const ss = doc.stations[sid];
        if (!ss) continue;
        stationSiblings.push({ id: sid, startX: ss.x, startY: ss.y });
      }
      for (const bid of sel.selectedRouteBulletIds) {
        const sb = doc.routeBullets[bid];
        if (!sb) continue;
        bulletSiblings.push({ id: bid, startX: sb.x, startY: sb.y });
      }
      for (const lid of sel.selectedLabelIds) {
        const lb = doc.textLabels[lid];
        if (!lb) continue;
        labelSiblings.push({ id: lid, startX: lb.x, startY: lb.y });
      }
    }
    wholeDragRef.current = {
      id,
      startVerts: poly.vertices.map((v) => ({ ...v })),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      polygonSiblings,
      stationSiblings,
      bulletSiblings,
      labelSiblings,
      history: beginHistoryGroup(),
    };
  };

  const onVertexPointerDown = (polygonId: string, index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const poly = useDoc.getState().polygons[polygonId];
    const v = poly?.vertices[index];
    if (!v) return;
    e.stopPropagation();
    vertexDragRef.current = {
      polygonId,
      index,
      startVert: { ...v },
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup(),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const wd = wholeDragRef.current;
    if (wd) {
      const dxScreen = e.clientX - wd.startMX;
      const dyScreen = e.clientY - wd.startMY;
      if (!wd.moved && Math.hypot(dxScreen, dyScreen) > 4) {
        wd.moved = true;
        dragState.suppressClick = true;
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      if (wd.moved) {
        const startAnchor = polygonSnapAnchor(wd.startVerts);
        let anchor: Vec2 = {
          x: startAnchor.x + dxScreen / zoom,
          y: startAnchor.y + dyScreen / zoom,
        };
        let guides: SnapGuide[] = [];
        const inGroupDrag =
          wd.polygonSiblings.length +
            wd.stationSiblings.length +
            wd.bulletSiblings.length +
            wd.labelSiblings.length >
          0;
        if (!e.shiftKey) {
          const doc = useDoc.getState();
          // During a group drag the other selected polygons are moving, so they
          // make unstable snap targets — drop alignment (empty targets) and let
          // only grid act on the anchor, mirroring useItemDrag.
          const allTargets = inGroupDrag
            ? []
            : [...stationStopCenters(doc.stations), ...otherPolygonVertices(doc.polygons, wd.id)];
          const snap = snapPolygonPoint({
            proposed: anchor,
            lineTargets: [],
            allTargets,
            modes: snapModes,
          });
          anchor = { x: snap.x, y: snap.y };
          guides = snap.guides;
        }
        const dx = anchor.x - startAnchor.x;
        const dy = anchor.y - startAnchor.y;
        setPolygonVertices(
          wd.id,
          wd.startVerts.map((v) => ({ x: v.x + dx, y: v.y + dy })),
        );
        setPolygonSnapGuides(guides);
        for (const ps of wd.polygonSiblings) {
          setPolygonVertices(
            ps.id,
            ps.startVerts.map((v) => ({ x: v.x + dx, y: v.y + dy })),
          );
        }
        for (const ss of wd.stationSiblings) {
          useDoc.getState().moveStation(ss.id, ss.startX + dx, ss.startY + dy);
        }
        for (const bs of wd.bulletSiblings) {
          useDoc.getState().moveRouteBullet(bs.id, bs.startX + dx, bs.startY + dy);
        }
        for (const ls of wd.labelSiblings) {
          useDoc.getState().moveTextLabel(ls.id, ls.startX + dx, ls.startY + dy);
        }
      }
    }

    const vd = vertexDragRef.current;
    if (vd) {
      const dxScreen = e.clientX - vd.startMX;
      const dyScreen = e.clientY - vd.startMY;
      if (!vd.moved && Math.hypot(dxScreen, dyScreen) > 4) {
        vd.moved = true;
        dragState.suppressClick = true;
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      if (vd.moved) {
        let p: Vec2 = {
          x: vd.startVert.x + dxScreen / zoom,
          y: vd.startVert.y + dyScreen / zoom,
        };
        let guides: SnapGuide[] = [];
        if (!e.shiftKey) {
          const doc = useDoc.getState();
          const poly = doc.polygons[vd.polygonId];
          const lineTargets = poly ? poly.vertices.filter((_, i) => i !== vd.index) : [];
          const allTargets = [
            ...stationStopCenters(doc.stations),
            ...polygonVerticesExceptVertex(doc.polygons, vd.polygonId, vd.index),
          ];
          const snap = snapPolygonPoint({ proposed: p, lineTargets, allTargets, modes: snapModes });
          p = { x: snap.x, y: snap.y };
          guides = snap.guides;
        }
        moveVertex(vd.polygonId, vd.index, p.x, p.y);
        setPolygonSnapGuides(guides);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wd = wholeDragRef.current;
    if (wd) {
      const wasMoved = wd.moved;
      wholeDragRef.current = null;
      setPolygonSnapGuides([]);
      if (wasMoved) {
        wd.history.commit();
        try {
          svgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may not have been captured
        }
        setTimeout(() => {
          dragState.suppressClick = false;
        }, 0);
      } else {
        wd.history.cancel();
      }
    }
    const vd = vertexDragRef.current;
    if (vd) {
      const wasMoved = vd.moved;
      vertexDragRef.current = null;
      setPolygonSnapGuides([]);
      if (wasMoved) {
        vd.history.commit();
        try {
          svgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may not have been captured
        }
        setTimeout(() => {
          dragState.suppressClick = false;
        }, 0);
      } else {
        vd.history.cancel();
      }
    }
  };

  return {
    polygonSnapGuides,
    onPolygonPointerDown,
    onVertexPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
