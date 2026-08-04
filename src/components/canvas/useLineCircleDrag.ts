import { RefObject, useCallback, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { type SnapGuide, snapGuidesEqual } from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';
import { useDragSnap } from './useDragSnap';
import { liveAlignTargets } from './snapTargets';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  emptyGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import type { LineCirclePart } from '../LineCircleView';

export interface LineCircleDragApi {
  snapGuides: SnapGuide[];
  // The circle whose radius is being knob-dragged right now (null otherwise) —
  // drives the diameter readout. State, not a ref: the label must re-render
  // with the gesture.
  resizingId: string | null;
  onStartDrag: (id: string, part: LineCirclePart, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Line-circle drags: grabbing the rim OR the centre handle MOVES the circle (its
 * bound stations ride along rigidly inside moveLineCircle); grabbing the resize
 * knob drags the RADIUS (bound stations reproject radially). The circle's centre
 * is the drag reference point for both moves and snaps through the point snapper
 * against the shared pool (like an unbound bullet); the radius snaps only to its
 * quarter-unit grid (inside the transform). Shift bypasses snapping, matching
 * every other drag.
 *
 * A move also tows the rest of a multi-selection, like every other master kind
 * (groupDrag). A knob drag never does — a resize isn't a translation.
 */
export function useLineCircleDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): LineCircleDragApi {
  const moveLineCircle = useDoc((s) => s.moveLineCircle);
  const setLineCircleRadius = useDoc((s) => s.setLineCircleRadius);
  // The point snapper already bound to the live prefs, grid and zoom — the same
  // one the polygon, svg-image and item drags reach for. The zoom conversion is
  // why: a site that re-threaded the raw world-unit tolerance would snap from
  // twice as far out at 2×.
  const { snapPoint } = useDragSnap(viewportZoom);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [resizingId, setResizingId] = useState<string | null>(null);

  const dragRef = useRef<{
    id: string;
    part: LineCirclePart;
    startWX: number; // circle center at pointer-down
    startWY: number;
    startRadius: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    // Move drags only (rim or centre handle): the rest of the multi-selection,
    // towed by the delta the circle's centre travels, and the snap pool with
    // those movers excluded. Empty for a knob.
    siblings: GroupSiblings;
    allTargets: Vec2[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);

  const onStartDrag = useCallback((id: string, part: LineCirclePart, e: React.PointerEvent) => {
    // Left button only, like every sibling drag hook. A middle-button press
    // bubbles through to MapCanvas's pan, and without this gate BOTH move
    // handlers would run per frame — the map pans and the ring travels with the
    // cursor, committing a displacement from a gesture meant as a pan. The right
    // button is excluded for the same reason, plus the trailing contextmenu.
    // Hand mode needs no gate here: LineCircleView makes the rim and the ⊕
    // click-through while the hand tool is up, so no press reaches this.
    if (e.button !== 0) return;
    const circle = useDoc.getState().lineCircles[id];
    if (!circle || circle.locked) return;
    // Selecting at pointer-down is this kind's convention (the resize knob and
    // the diameter popover appear as you grab it). Two grabs must NOT re-select,
    // or the gesture destroys the selection it should be acting on —
    // selectLineCircle clears every other list:
    //   - a ring already IN the selection: that would kill the group drag
    //     before collectGroupSiblings ever sees the siblings;
    //   - a Shift-grab: the click's shift-toggle owns adding/removing a ring,
    //     exactly as it does for every other item.
    const sel = useSelection.getState();
    if (!e.shiftKey && !sel.selectedLineCircleIds.includes(id)) sel.selectLineCircle(id);
    // Every part EXCEPT the knob is a translation, so every one of them tows the
    // group. Spelled as "not the knob" rather than a list of movers: a new grab
    // added to the ring is a move until proven otherwise, and the failure of
    // forgetting it — a group that silently stops following — is silent.
    const siblings =
      part === 'knob' ? emptyGroupSiblings() : collectGroupSiblings('lineCircle', id);
    dragRef.current = {
      id,
      part,
      startWX: circle.x,
      startWY: circle.y,
      startRadius: circle.radius,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      // Snapshotted at pointer-down like every other drag: everything in the
      // pool is stationary for the gesture, and the movers (the ring's own
      // passengers, plus any towed sibling) are excluded — a target that moves
      // with the grab drags the snap along with it.
      allTargets: liveAlignTargets(groupAlignExclude('lineCircle', id, siblings)),
      history: beginHistoryGroup({ deferPersist: true }),
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    if (pointerLost(e)) return onPointerCancel();
    const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    const dx = dxScreen / viewportZoom;
    const dy = dyScreen / viewportZoom;
    if (ds.part === 'knob') {
      // The knob sits on the east point, so the radius follows the pointer's
      // horizontal world distance from the center. Quarter-grid + minimum are
      // the transform's clamp; nothing else to snap to. The diameter readout
      // arms on the first real move (not pointer-down, so a click shows none).
      if (resizingId !== ds.id) setResizingId(ds.id);
      setLineCircleRadius(ds.id, ds.startRadius + dx);
      return;
    }
    let nx = ds.startWX + dx;
    let ny = ds.startWY + dy;
    if (!e.shiftKey) {
      const snap = snapPoint({ x: nx, y: ny }, { allTargets: ds.allTargets });
      nx = snap.x;
      ny = snap.y;
      setSnapGuides((prev) => (snapGuidesEqual(prev, snap.guides) ? prev : snap.guides));
    } else if (snapGuides.length > 0) {
      setSnapGuides([]);
    }
    moveLineCircle(ds.id, nx, ny);
    if (hasGroupSiblings(ds.siblings)) {
      translateSiblings(ds.siblings, nx - ds.startWX, ny - ds.startWY);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setSnapGuides([]);
    setResizingId(null);
    finishDrag(ds, e, svgRef);
  };

  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setSnapGuides([]);
    setResizingId(null);
    ds.history.rollback();
  };

  return { snapGuides, resizingId, onStartDrag, onPointerMove, onPointerUp, onPointerCancel };
}
