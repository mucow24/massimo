import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { SNAP_PERP_TOLERANCE, type SnapGuide } from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';
import { finishDrag, trackDragMove } from './dragGesture';
import { alignTargets } from './snapTargets';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';

// Whole-polygon drag: snapshot every vertex at pointer-down; each move snaps the
// highest-then-leftmost vertex and translates the whole shape by that delta.
// Group siblings (other selected items of every type) tow by the same delta.
type WholeDragState = {
  id: string;
  startVerts: Vec2[];
  startMX: number;
  startMY: number;
  moved: boolean;
  siblings: GroupSiblings;
  // "Snap to all" pool, snapshotted at pointer-down (everything in it is
  // stationary for the duration of the drag). In a group drag it excludes the
  // dragged polygon AND every co-moving sibling (they'd be unstable targets);
  // stationary items stay valid targets. See the alignTargets call below.
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

// Vertex drag: move one or more of a polygon's vertices together. The GRABBED
// vertex is snapped; the whole moving set tows by that snapped delta. Each move
// re-derives from `startVerts` (the full pointer-down snapshot) so the shape
// never accumulates drift, exactly like the whole-polygon drag. `forceCommit`
// is set for a drag that began by inserting a vertex (the edge "+"): the insert
// is a real change, so the gesture commits one history entry even if the
// pointer never moved past the threshold.
type VertexDragState = {
  polygonId: string;
  // Indices being moved together (>=1). Equal to the current selectedVertices
  // set when the grabbed vertex is a member; otherwise just the grabbed vertex
  // (a non-member grab moves solo — mirrors collectGroupSiblings for items).
  indices: number[];
  // The grabbed vertex; its snapped position sets the delta for the whole set.
  grabIndex: number;
  startVerts: Vec2[];
  startMX: number;
  startMY: number;
  moved: boolean;
  forceCommit: boolean;
  // Snap targets, snapshotted at pointer-down (excluding every moving vertex so
  // the set never snaps to itself): "Snap to line" aligns to the polygon's own
  // non-moving vertices; "Snap to all" to the shared pool plus those same
  // vertices (own-shape alignment stays available through either toggle).
  lineTargets: Vec2[];
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface PolygonDragApi {
  polygonSnapGuides: SnapGuide[];
  onPolygonPointerDown: (id: string, e: React.PointerEvent) => void;
  onVertexPointerDown: (polygonId: string, index: number, e: React.PointerEvent) => void;
  // Inserts the edge midpoint as a real vertex and immediately starts dragging
  // it; a plain click leaves the new vertex at the midpoint.
  onEdgeAddPointerDown: (polygonId: string, edgeIndex: number, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Owns drag state for polygons: whole-shape moves and single-vertex edits. The
 * gesture lifecycle (4px threshold, one history entry, pointer capture, click
 * suppression) and the whole-shape group-drag towing are shared with the other
 * drag hooks via dragGesture + groupDrag; snapping routes through
 * {@link snapPolygonPoint} so "Snap to line" aligns to the polygon's own
 * vertices and "Snap to all" aligns to the shared {@link alignTargets} pool
 * (stations, polygon vertices, image corners, label points, bullet centers).
 */
export function usePolygonDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  inHandMode: boolean,
): PolygonDragApi {
  const setPolygonVertices = useDoc((s) => s.setPolygonVertices);
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridSize = useViewportStore((s) => s.gridSize);

  const wholeDragRef = useRef<WholeDragState | null>(null);
  const vertexDragRef = useRef<VertexDragState | null>(null);
  const [polygonSnapGuides, setPolygonSnapGuides] = useState<SnapGuide[]>([]);

  const onPolygonPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const doc = useDoc.getState();
    const poly = doc.polygons[id];
    if (!poly) return;
    // A locked polygon can't be dragged. Don't stop propagation: let the event
    // bubble to the canvas so a drag starting on it begins a marquee-select
    // (the activation gate treats locked elements as background). A plain
    // no-move click still falls through to select it, so the popover — and its
    // unlock toggle — stays reachable.
    if (poly.locked) return;
    e.stopPropagation();
    // Group-drag: tow every other selected item by the same delta. Locked
    // polygons are skipped (handled in collectGroupSiblings).
    const siblings = collectGroupSiblings('polygon', id);
    wholeDragRef.current = {
      id,
      startVerts: poly.vertices.map((v) => ({ ...v })),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      // The pool excludes the dragged polygon and every co-selected sibling
      // (they move with the grab); stationary items stay valid targets even
      // during a group drag.
      allTargets: alignTargets(doc, groupAlignExclude('polygon', id, siblings)),
      history: beginHistoryGroup(),
    };
  };

  // Vertex-drag snap targets: the polygon's own non-moving vertices serve "Snap
  // to line", and the shared pool (which excludes the whole polygon) plus those
  // same vertices serves "Snap to all" — so own-shape alignment works through
  // either toggle, and no moving vertex ever targets itself or a co-mover.
  const vertexDragTargets = (polygonId: string, moving: Set<number>) => {
    const doc = useDoc.getState();
    const others = doc.polygons[polygonId]?.vertices.filter((_, i) => !moving.has(i)) ?? [];
    return {
      lineTargets: others,
      allTargets: [...alignTargets(doc, { polygonIds: new Set([polygonId]) }), ...others],
    };
  };

  const onVertexPointerDown = (polygonId: string, index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const poly = useDoc.getState().polygons[polygonId];
    const v = poly?.vertices[index];
    if (!v || poly?.locked) return;
    e.stopPropagation();
    // Grabbing a vertex that's part of the current selection tows the whole
    // set; grabbing any other vertex moves just it. Same rule as group-drag
    // (collectGroupSiblings): dragging an unselected member never tows.
    const sel = useSelection.getState().selectedVertices;
    const indices =
      sel && sel.polygonId === polygonId && sel.indices.includes(index) ? sel.indices : [index];
    vertexDragRef.current = {
      polygonId,
      indices,
      grabIndex: index,
      startVerts: poly.vertices.map((p) => ({ ...p })),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      forceCommit: false,
      ...vertexDragTargets(polygonId, new Set(indices)),
      history: beginHistoryGroup(),
    };
  };

  const onEdgeAddPointerDown = (polygonId: string, edgeIndex: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const doc = useDoc.getState();
    const poly = doc.polygons[polygonId];
    if (!poly || poly.locked) return;
    e.stopPropagation();
    // Suppress the trailing click so a no-drag "+" tap doesn't re-trigger
    // polygon/background click handlers (which would clear the vertex we just
    // inserted + selected). finishDrag resets it after the (forced) commit.
    dragState.suppressClick = true;
    // One history entry for the whole gesture: pause first, insert the midpoint
    // vertex (lands at edgeIndex + 1), then drag it. forceCommit makes even a
    // no-move click persist the insert.
    const history = beginHistoryGroup();
    doc.insertVertex(polygonId, edgeIndex);
    const newIndex = edgeIndex + 1;
    const polyAfter = useDoc.getState().polygons[polygonId];
    if (!polyAfter?.vertices[newIndex]) {
      history.cancel();
      return;
    }
    useSelection.getState().selectVertices({ polygonId, indices: [newIndex] });
    vertexDragRef.current = {
      polygonId,
      indices: [newIndex],
      grabIndex: newIndex,
      startVerts: polyAfter.vertices.map((p) => ({ ...p })),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      forceCommit: true,
      // Computed after the insert so the new vertex is the excluded one.
      ...vertexDragTargets(polygonId, new Set([newIndex])),
      history,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const wd = wholeDragRef.current;
    if (wd) {
      const { moved, dxScreen, dyScreen } = trackDragMove(wd, e, svgRef);
      if (moved) {
        const startAnchor = polygonSnapAnchor(wd.startVerts);
        let anchor: Vec2 = {
          x: startAnchor.x + dxScreen / zoom,
          y: startAnchor.y + dyScreen / zoom,
        };
        let guides: SnapGuide[] = [];
        const inGroupDrag = hasGroupSiblings(wd.siblings);
        if (!e.shiftKey) {
          const snap = snapPolygonPoint({
            proposed: anchor,
            lineTargets: [],
            allTargets: wd.allTargets,
            modes: snapModes,
            // Constant screen-pixel engage radius (see useStationDrag).
            tolerance: SNAP_PERP_TOLERANCE / zoom,
            gridInterval: gridSize,
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
        if (inGroupDrag) translateSiblings(wd.siblings, dx, dy);
      }
    }

    const vd = vertexDragRef.current;
    if (vd) {
      const { moved, dxScreen, dyScreen } = trackDragMove(vd, e, svgRef);
      if (moved) {
        const start = vd.startVerts[vd.grabIndex];
        let p: Vec2 = {
          x: start.x + dxScreen / zoom,
          y: start.y + dyScreen / zoom,
        };
        let guides: SnapGuide[] = [];
        if (!e.shiftKey) {
          const snap = snapPolygonPoint({
            proposed: p,
            lineTargets: vd.lineTargets,
            allTargets: vd.allTargets,
            modes: snapModes,
            // Constant screen-pixel engage radius (see useStationDrag).
            tolerance: SNAP_PERP_TOLERANCE / zoom,
            gridInterval: gridSize,
          });
          p = { x: snap.x, y: snap.y };
          guides = snap.guides;
        }
        // Tow every moving vertex by the grabbed vertex's (snapped) delta,
        // re-derived from the pointer-down snapshot to stay drift-free.
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        const moving = new Set(vd.indices);
        setPolygonVertices(
          vd.polygonId,
          vd.startVerts.map((sv, i) => (moving.has(i) ? { x: sv.x + dx, y: sv.y + dy } : sv)),
        );
        setPolygonSnapGuides(guides);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wd = wholeDragRef.current;
    if (wd) {
      wholeDragRef.current = null;
      setPolygonSnapGuides([]);
      finishDrag(wd, e, svgRef);
    }
    const vd = vertexDragRef.current;
    if (vd) {
      vertexDragRef.current = null;
      setPolygonSnapGuides([]);
      finishDrag(vd, e, svgRef);
    }
  };

  // Browser pointercancel: disarm whichever drag is armed (whole-shape or
  // single-vertex) and roll the doc back to its pre-drag snapshot instead of
  // committing. The snapshot restore also un-inserts an edge-add vertex, so its
  // dangling sub-selection is cleared here. See useStationDrag for rationale.
  const onPointerCancel = () => {
    const wd = wholeDragRef.current;
    const vd = vertexDragRef.current;
    if (!wd && !vd) return;
    wholeDragRef.current = null;
    vertexDragRef.current = null;
    setPolygonSnapGuides([]);
    if (vd?.forceCommit) useSelection.getState().selectVertices(null);
    wd?.history.rollback();
    vd?.history.rollback();
  };

  return {
    polygonSnapGuides,
    onPolygonPointerDown,
    onVertexPointerDown,
    onEdgeAddPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
