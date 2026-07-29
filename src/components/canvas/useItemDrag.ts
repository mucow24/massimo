import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import { snapDraggedStation, snapToleranceAt, type SnapGuide } from '../../geometry/snap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { textLabelCorners } from '../../geometry/stationBoundary';
import type { Vec2 } from '../../geometry/vec';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import { liveAlignTargets, liveSnapStations } from './snapTargets';
import { useDragSnap } from './useDragSnap';

// Drag state for a free-floating x/y item. `kind` selects the per-frame snap;
// everything else (lifecycle, group towing) is shared.
type ItemDragState = {
  kind: 'bullet' | 'label' | 'anchor';
  id: string;
  startWX: number;
  startWY: number;
  startMX: number;
  startMY: number;
  moved: boolean;
  siblings: GroupSiblings;
  // Co-selected stations, excluded from the bullet snap engine's candidate
  // pool — they move with the group, so they're unstable targets. Mirrors
  // useStationDrag's siblingIdSet.
  siblingStationIds: ReadonlySet<string>;
  // Label drags only: offset from the label center to its snap anchor (the
  // topmost-then-leftmost visible rotated corner) and the "Snap to all" pool,
  // both snapshotted at pointer-down. Zero/empty for bullets.
  anchorOff: Vec2;
  allTargets: Vec2[];
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface ItemDragApi {
  itemSnapGuides: SnapGuide[];
  onBulletPointerDown: (id: string, e: React.PointerEvent) => void;
  onLabelPointerDown: (id: string, e: React.PointerEvent) => void;
  onAnchorPointerDown: (id: string, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Owns drag state for the free-floating items — route bullets and text labels —
 * with a single gesture state machine for both. They differ only in their
 * per-frame snap: a bound bullet reuses the station snap engine in bullet mode
 * (grid fallback when unbound); a label snaps its topmost-then-leftmost visible
 * corner through the point snapper against the shared {@link liveAlignTargets}
 * pool. The drag lifecycle (threshold, capture, click suppression, one history
 * entry) and the multi-selection sibling towing are shared via dragGesture +
 * groupDrag.
 */
export function useItemDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  inHandMode: boolean,
): ItemDragApi {
  const routeBullets = useDoc((s) => s.routeBullets);
  const textLabels = useDoc((s) => s.textLabels);
  const transferAnchors = useDoc((s) => s.transferAnchors);
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const moveRouteBullet = useDoc((s) => s.moveRouteBullet);
  const moveTextLabel = useDoc((s) => s.moveTextLabel);
  const moveTransferAnchor = useDoc((s) => s.moveTransferAnchor);
  const { modes: snapModes, gridInterval: gridSize, snapPoint } = useDragSnap(zoom);

  const dragRef = useRef<ItemDragState | null>(null);
  const [itemSnapGuides, setItemSnapGuides] = useState<SnapGuide[]>([]);

  const begin = (
    kind: 'bullet' | 'label' | 'anchor',
    id: string,
    wx: number,
    wy: number,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    // A locked item can't be dragged. Bail BEFORE stopping propagation so the
    // event bubbles to the canvas: a drag starting on it then begins a
    // marquee-select (the rect-select gate treats [data-locked] as background).
    // A plain no-move click still selects it, so the popover — and its unlock
    // toggle — stays reachable. Mirrors usePolygonDrag's locked guard.
    // Anchors are the one draggable kind with a MODE gate. This hook has none
    // otherwise, and an anchor is clickable in creating-transfer mode (that is
    // the whole point) — without the gate a 4px wobble while picking a transfer
    // end would start a drag, set suppressClick, and silently eat the pick.
    if (kind === 'anchor' && useSelection.getState().uiMode.kind !== 'idle') return;
    // Anchors have no `locked` field, so they are never lock-blocked.
    const item =
      kind === 'bullet' ? routeBullets[id] : kind === 'label' ? textLabels[id] : undefined;
    if (item?.locked) return;
    e.stopPropagation();
    // Tow the rest of the multi-selection (every type) by the same delta.
    const siblings = collectGroupSiblings(kind, id);
    // Point-snapper geometry, fixed for the whole gesture: the snap anchor's
    // offset from the item position (a label's topmost-then-leftmost visible
    // corner; a bullet is its own anchor) and the target pool (everything in
    // it is stationary; the item and co-selected siblings are excluded).
    let anchorOff: Vec2 = { x: 0, y: 0 };
    if (kind === 'label') {
      const anchor = polygonSnapAnchor(textLabelCorners(textLabels[id]));
      anchorOff = { x: anchor.x - wx, y: anchor.y - wy };
    }
    const allTargets = liveAlignTargets(groupAlignExclude(kind, id, siblings));
    dragRef.current = {
      kind,
      id,
      startWX: wx,
      startWY: wy,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      siblingStationIds: new Set(siblings.stations.map((s) => s.id)),
      anchorOff,
      allTargets,
      history: beginHistoryGroup(),
    };
  };

  const onBulletPointerDown = (id: string, e: React.PointerEvent) => {
    const b = routeBullets[id];
    if (!b) return;
    begin('bullet', id, b.x, b.y, e);
  };

  const onLabelPointerDown = (id: string, e: React.PointerEvent) => {
    const lbl = textLabels[id];
    if (!lbl) return;
    begin('label', id, lbl.x, lbl.y, e);
  };

  const onAnchorPointerDown = (id: string, e: React.PointerEvent) => {
    const a = transferAnchors[id];
    if (!a) return;
    begin('anchor', id, a.x, a.y, e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move.
    if (pointerLost(e)) return onPointerCancel();
    const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    let nx = ds.startWX + dxScreen / zoom;
    let ny = ds.startWY + dyScreen / zoom;
    const inGroupDrag = hasGroupSiblings(ds.siblings);

    if (ds.kind === 'bullet') {
      const cur = routeBullets[ds.id];
      const lineId = cur?.lineId ?? null;
      if (e.shiftKey) {
        if (itemSnapGuides.length > 0) setItemSnapGuides([]);
      } else if (lineId) {
        // Bound bullet: reuse the station snap engine in bullet mode — it
        // already handles per-stop axis alignment, two-axis corner snap, and
        // the "third in-line station" opposite-direction guide. In a group
        // drag, co-selected stations are excluded (they move with the grab);
        // stationary stations stay valid targets.
        const snap = snapDraggedStation({
          proposedX: nx,
          proposedY: ny,
          // Gated: a bound bullet is still draggable with the network hidden,
          // and must not align to stations that aren't on the canvas.
          stations: liveSnapStations(stations),
          lines,
          tolerance: snapToleranceAt(zoom),
          bulletLineId: lineId,
          excludedIds: ds.siblingStationIds.size > 0 ? ds.siblingStationIds : undefined,
          modes: snapModes,
          gridInterval: gridSize,
        });
        nx = snap.x;
        ny = snap.y;
        setItemSnapGuides(snap.guides);
      } else {
        // Unbound bullet: no line to align along, but the center still snaps
        // through the point snapper — "Snap to all" + grid — like every other
        // decoration item.
        const snap = snapPoint({ x: nx, y: ny }, { allTargets: ds.allTargets });
        nx = snap.x;
        ny = snap.y;
        setItemSnapGuides(snap.guides);
      }
      moveRouteBullet(ds.id, nx, ny);
    } else if (ds.kind === 'anchor') {
      // A bare point with no line to align along, exactly like an unbound
      // bullet: the center snaps through the point snapper — "Snap to all" +
      // grid — against the shared pool. Shift bypasses.
      let guides: SnapGuide[] = [];
      if (!e.shiftKey) {
        const snap = snapPoint({ x: nx, y: ny }, { allTargets: ds.allTargets });
        nx = snap.x;
        ny = snap.y;
        guides = snap.guides;
      }
      setItemSnapGuides(guides);
      moveTransferAnchor(ds.id, nx, ny);
    } else {
      // Labels snap like polygons/images: the topmost-then-leftmost visible
      // (rotated, unpadded) corner aligns against the shared pool, with grid
      // as the hard constraint. Shift bypasses.
      let guides: SnapGuide[] = [];
      if (!e.shiftKey) {
        const snap = snapPoint(
          { x: nx + ds.anchorOff.x, y: ny + ds.anchorOff.y },
          { allTargets: ds.allTargets },
        );
        nx = snap.x - ds.anchorOff.x;
        ny = snap.y - ds.anchorOff.y;
        guides = snap.guides;
      }
      setItemSnapGuides(guides);
      moveTextLabel(ds.id, nx, ny);
    }

    if (inGroupDrag) {
      translateSiblings(ds.siblings, nx - ds.startWX, ny - ds.startWY);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setItemSnapGuides([]);
    finishDrag(ds, e, svgRef);
  };

  // Browser pointercancel: disarm the drag and roll the doc back to its
  // pre-drag snapshot (reverting the live move + any towed siblings) instead of
  // committing. See useStationDrag for the full rationale.
  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setItemSnapGuides([]);
    ds.history.rollback();
  };

  return {
    itemSnapGuides,
    onBulletPointerDown,
    onLabelPointerDown,
    onAnchorPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
