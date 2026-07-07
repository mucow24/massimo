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
  // stationary for the duration of the drag). Empty during a group drag —
  // co-moving siblings would be unstable targets (phase-2 work narrows this
  // to an exclusion set).
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

// Single-vertex drag: snap the dragged vertex itself. `forceCommit` is set for
// a drag that began by inserting a vertex (the edge "+"): the insert is a real
// change, so the gesture commits one history entry even if the pointer never
// moved past the threshold.
type VertexDragState = {
  polygonId: string;
  index: number;
  startVert: Vec2;
  startMX: number;
  startMY: number;
  moved: boolean;
  forceCommit: boolean;
  // Snap targets, snapshotted at pointer-down: "Snap to line" aligns to the
  // polygon's own other vertices; "Snap to all" to the shared pool plus those
  // same siblings (own-shape alignment stays available through either toggle).
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
  const moveVertex = useDoc((s) => s.moveVertex);
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
      // During a group drag the other selected items are moving, so they make
      // unstable snap targets — drop alignment (empty pool) and let only grid
      // act on the anchor, mirroring useItemDrag / useSvgImageDrag.
      allTargets: hasGroupSiblings(siblings)
        ? []
        : alignTargets(doc, { polygonIds: new Set([id]) }),
      history: beginHistoryGroup(),
    };
  };

  // Vertex-drag snap targets: the polygon's own other vertices serve "Snap to
  // line", and the shared pool (which excludes the whole polygon) plus those
  // same siblings serves "Snap to all" — so own-shape alignment works through
  // either toggle, and the dragged vertex never targets itself.
  const vertexDragTargets = (polygonId: string, index: number) => {
    const doc = useDoc.getState();
    const others = doc.polygons[polygonId]?.vertices.filter((_, i) => i !== index) ?? [];
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
    vertexDragRef.current = {
      polygonId,
      index,
      startVert: { ...v },
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      forceCommit: false,
      ...vertexDragTargets(polygonId, index),
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
    const v = useDoc.getState().polygons[polygonId]?.vertices[newIndex];
    if (!v) {
      history.cancel();
      return;
    }
    useSelection.getState().selectVertex({ polygonId, index: newIndex });
    vertexDragRef.current = {
      polygonId,
      index: newIndex,
      startVert: { ...v },
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      forceCommit: true,
      // Computed after the insert so the new vertex is the excluded one.
      ...vertexDragTargets(polygonId, newIndex),
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
        let p: Vec2 = {
          x: vd.startVert.x + dxScreen / zoom,
          y: vd.startVert.y + dyScreen / zoom,
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
        moveVertex(vd.polygonId, vd.index, p.x, p.y);
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
    if (vd?.forceCommit) useSelection.getState().selectVertex(null);
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
