import { RefObject, useRef } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useRoutedSnapGuides } from './useRoutedSnapGuides';
import type { SnapGuide } from '../../geometry/snap';
import {
  normalizeRotation,
  resizeSvgImageCorner,
  resizeSvgImageEdge,
  rotateSvgImageTo,
  svgImageCorners,
  svgImageSnapAnchor,
  type SvgImageGeom,
} from '../../geometry/svgImage';
import type { Vec2 } from '../../geometry/vec';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import { useDragSnap } from './useDragSnap';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import { liveAlignTargets } from './snapTargets';

type ScreenToWorld = (mx: number, my: number) => Vec2;

// Whole-image move: snapshot the image at pointer-down; each move snaps the
// highest-then-leftmost (rotated) corner and translates the center by that delta.
type MoveState = {
  id: string;
  start: SvgImageGeom;
  startMX: number;
  startMY: number;
  moved: boolean;
  siblings: GroupSiblings;
  // "Snap to all" pool, snapshotted at pointer-down. In a group drag it
  // excludes the dragged image AND every co-moving sibling (they'd be unstable
  // targets); stationary items stay valid targets. See the liveAlignTargets call
  // below.
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

// Corner/edge resize: feed the live pointer (snapped when axis-aligned) and the
// START image to the pure resize math, which pins the opposite corner/edge.
type ResizeState = {
  id: string;
  kind: 'corner' | 'edge';
  index: number;
  start: SvgImageGeom;
  startMX: number;
  startMY: number;
  moved: boolean;
  // "Snap to all" pool for the moving handle, snapshotted at pointer-down.
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

// Rotate: angle from the START center to the live pointer; snaps to 22.5°
// steps by default, Shift frees.
type RotateState = {
  id: string;
  start: SvgImageGeom;
  startMX: number;
  startMY: number;
  moved: boolean;
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface SvgImageDragApi {
  svgImageSnapGuides: SnapGuide[];
  onSvgImagePointerDown: (id: string, e: React.PointerEvent) => void;
  onSvgCornerPointerDown: (id: string, cornerIndex: number, e: React.PointerEvent) => void;
  onSvgEdgePointerDown: (id: string, edgeIndex: number, e: React.PointerEvent) => void;
  onSvgRotatePointerDown: (id: string, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

const geomOf = (im: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): SvgImageGeom => ({
  x: im.x,
  y: im.y,
  width: im.width,
  height: im.height,
  rotation: im.rotation,
});

/**
 * Owns drag state for svg images: whole-image moves, corner (proportional) and
 * edge (single-axis) resizes, and rotation. The gesture lifecycle and the
 * whole-image group-drag towing are shared with the other drag hooks via
 * dragGesture + groupDrag. Move + axis-aligned resize snap through
 * {@link snapPolygonPoint} against the shared {@link liveAlignTargets} pool (same
 * targets as polygons); rotation snaps to 22.5° multiples by default (Shift
 * frees it), never to the grid.
 */
export function useSvgImageDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  inHandMode: boolean,
  screenToWorld: ScreenToWorld,
): SvgImageDragApi {
  const moveSvgImage = useDoc((s) => s.moveSvgImage);
  const updateSvgImage = useDoc((s) => s.updateSvgImage);
  const { snapPoint } = useDragSnap(zoom);

  const moveRef = useRef<MoveState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const rotateRef = useRef<RotateState | null>(null);
  const [svgImageSnapGuides, setSvgImageSnapGuides] = useRoutedSnapGuides('svgImage');

  const onSvgImagePointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 || inHandMode) return;
    const im = useDoc.getState().svgImages[id];
    if (!im) return;
    // A locked image can't be dragged. Don't stop propagation: let the event
    // bubble so a drag starting on it begins a marquee (the gate treats locked
    // elements as background). A plain click still selects it (popover unlock).
    if (im.locked) return;
    e.stopPropagation();
    const siblings = collectGroupSiblings('svgImage', id);
    moveRef.current = {
      id,
      start: geomOf(im),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      // The pool excludes the dragged image and every co-selected sibling
      // (they move with the grab); stationary items stay valid targets even
      // during a group drag.
      allTargets: liveAlignTargets(groupAlignExclude('svgImage', id, siblings)),
      history: beginHistoryGroup({ deferPersist: true }),
    };
  };

  const beginResize = (
    id: string,
    kind: 'corner' | 'edge',
    index: number,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0 || inHandMode) return;
    const im = useDoc.getState().svgImages[id];
    if (!im || im.locked) return;
    e.stopPropagation();
    resizeRef.current = {
      id,
      kind,
      index,
      start: geomOf(im),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      allTargets: liveAlignTargets({ svgImageIds: new Set([id]) }),
      history: beginHistoryGroup({ deferPersist: true }),
    };
  };

  const onSvgCornerPointerDown = (id: string, cornerIndex: number, e: React.PointerEvent) =>
    beginResize(id, 'corner', cornerIndex, e);
  const onSvgEdgePointerDown = (id: string, edgeIndex: number, e: React.PointerEvent) =>
    beginResize(id, 'edge', edgeIndex, e);

  const onSvgRotatePointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 || inHandMode) return;
    const im = useDoc.getState().svgImages[id];
    if (!im || im.locked) return;
    e.stopPropagation();
    rotateRef.current = {
      id,
      start: geomOf(im),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup({ deferPersist: true }),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move.
    if ((moveRef.current || resizeRef.current || rotateRef.current) && pointerLost(e)) {
      return onPointerCancel();
    }
    const mv = moveRef.current;
    if (mv) {
      const { moved, dxScreen, dyScreen } = trackDragMove(mv, e, svgRef);
      if (moved) {
        const startAnchor = svgImageSnapAnchor(mv.start);
        let anchor: Vec2 = {
          x: startAnchor.x + dxScreen / zoom,
          y: startAnchor.y + dyScreen / zoom,
        };
        let guides: SnapGuide[] = [];
        const inGroupDrag = hasGroupSiblings(mv.siblings);
        if (!e.shiftKey) {
          const snap = snapPoint(anchor, { allTargets: mv.allTargets });
          anchor = { x: snap.x, y: snap.y };
          guides = snap.guides;
        }
        const dx = anchor.x - startAnchor.x;
        const dy = anchor.y - startAnchor.y;
        moveSvgImage(mv.id, mv.start.x + dx, mv.start.y + dy);
        setSvgImageSnapGuides(guides);
        if (inGroupDrag) translateSiblings(mv.siblings, dx, dy);
      }
    }

    const rz = resizeRef.current;
    if (rz) {
      const { moved } = trackDragMove(rz, e, svgRef);
      if (moved) {
        let pointer = screenToWorld(e.clientX, e.clientY);
        let guides: SnapGuide[] = [];
        // Snap the moving handle only while the image is axis-aligned; once
        // rotated off-axis, snapping a corner to a grid point would distort it.
        const axisAligned = normalizeRotation(rz.start.rotation) % 90 === 0;
        if (axisAligned && !e.shiftKey) {
          const snap = snapPoint(pointer, {
            allTargets: rz.allTargets,
            // An edge resize has one degree of freedom — only snaps along
            // that world axis are considered, so a guide can never show a
            // perpendicular alignment the resize would discard. At 0/180 the
            // odd (right/left) edges move along world X; at 90/270 they move
            // along world Y.
            constrain:
              rz.kind === 'edge'
                ? (rz.index % 2 === 1) === (normalizeRotation(rz.start.rotation) % 180 === 0)
                  ? 'x'
                  : 'y'
                : undefined,
          });
          pointer = { x: snap.x, y: snap.y };
          guides = snap.guides;
        }
        const box =
          rz.kind === 'corner'
            ? resizeSvgImageCorner(rz.start, rz.index, pointer)
            : resizeSvgImageEdge(rz.start, rz.index, pointer);
        // Corner honesty: the aspect lock (or min-size clamp) can override the
        // snapped point. If the dragged corner didn't actually land there, the
        // guides would point at empty space — drop them.
        if (rz.kind === 'corner' && guides.length > 0) {
          const corner = svgImageCorners({ ...box, rotation: rz.start.rotation })[rz.index];
          if (Math.hypot(corner.x - pointer.x, corner.y - pointer.y) > 1e-6) guides = [];
        }
        updateSvgImage(rz.id, box);
        setSvgImageSnapGuides(guides);
      }
    }

    const rot = rotateRef.current;
    if (rot) {
      const { moved } = trackDragMove(rot, e, svgRef);
      if (moved) {
        const pointer = screenToWorld(e.clientX, e.clientY);
        // Rotation snaps to 22.5° steps by default; Shift frees it — the same
        // "Shift bypasses snapping" rule as every other gesture.
        const deg = rotateSvgImageTo(rot.start, pointer, !e.shiftKey);
        updateSvgImage(rot.id, { rotation: deg });
        // Rotation never produces alignment guides.
        setSvgImageSnapGuides([]);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // Exit first, clear second: the exit drains the pipeline, so the clear
    // lands in hook state instead of being routed away (useRoutedSnapGuides).
    const mv = moveRef.current;
    if (mv) {
      moveRef.current = null;
      finishDrag(mv, e, svgRef);
      setSvgImageSnapGuides([]);
    }
    const rz = resizeRef.current;
    if (rz) {
      resizeRef.current = null;
      finishDrag(rz, e, svgRef);
      setSvgImageSnapGuides([]);
    }
    const rot = rotateRef.current;
    if (rot) {
      rotateRef.current = null;
      finishDrag(rot, e, svgRef);
      setSvgImageSnapGuides([]);
    }
  };

  // Browser pointercancel: disarm whichever gesture is armed (move / resize /
  // rotate) and roll the doc back to its pre-drag snapshot instead of
  // committing. See useStationDrag for the full rationale.
  const onPointerCancel = () => {
    const mv = moveRef.current;
    const rz = resizeRef.current;
    const rot = rotateRef.current;
    if (!mv && !rz && !rot) return;
    moveRef.current = null;
    resizeRef.current = null;
    rotateRef.current = null;
    mv?.history.rollback();
    rz?.history.rollback();
    rot?.history.rollback();
    setSvgImageSnapGuides([]);
  };

  return {
    svgImageSnapGuides,
    onSvgImagePointerDown,
    onSvgCornerPointerDown,
    onSvgEdgePointerDown,
    onSvgRotatePointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
