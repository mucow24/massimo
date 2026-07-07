import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import {
  SNAP_PERP_TOLERANCE,
  snapDraggedStation,
  snapPointToGrid,
  type SnapGuide,
} from '../../geometry/snap';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import { finishDrag, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import { alignTargets, textLabelCorners } from './snapTargets';

const BULLET_SNAP_TOLERANCE = 10;

// Drag state for a free-floating x/y item. `kind` selects the per-frame snap;
// everything else (lifecycle, group towing) is shared.
type ItemDragState = {
  kind: 'bullet' | 'label';
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
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Owns drag state for the free-floating items — route bullets and text labels —
 * with a single gesture state machine for both. They differ only in their
 * per-frame snap: a bound bullet reuses the station snap engine in bullet mode
 * (grid fallback when unbound); a label snaps its topmost-then-leftmost visible
 * corner through the point snapper against the shared {@link alignTargets}
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
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const moveRouteBullet = useDoc((s) => s.moveRouteBullet);
  const moveTextLabel = useDoc((s) => s.moveTextLabel);
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridSize = useViewportStore((s) => s.gridSize);

  const dragRef = useRef<ItemDragState | null>(null);
  const [itemSnapGuides, setItemSnapGuides] = useState<SnapGuide[]>([]);

  const begin = (
    kind: 'bullet' | 'label',
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
    const item = kind === 'bullet' ? routeBullets[id] : textLabels[id];
    if (item?.locked) return;
    e.stopPropagation();
    // Tow the rest of the multi-selection (every type) by the same delta.
    const siblings = collectGroupSiblings(kind, id);
    // Label snap geometry, fixed for the whole gesture: the anchor corner's
    // offset from the center (rotation and size don't change mid-drag) and
    // the target pool (everything in it is stationary; co-selected siblings
    // are excluded).
    let anchorOff: Vec2 = { x: 0, y: 0 };
    let allTargets: Vec2[] = [];
    if (kind === 'label') {
      const anchor = polygonSnapAnchor(textLabelCorners(textLabels[id]));
      anchorOff = { x: anchor.x - wx, y: anchor.y - wy };
      allTargets = alignTargets(useDoc.getState(), groupAlignExclude('label', id, siblings));
    }
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

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    let nx = ds.startWX + dxScreen / zoom;
    let ny = ds.startWY + dyScreen / zoom;
    const inGroupDrag = hasGroupSiblings(ds.siblings);

    if (ds.kind === 'bullet') {
      const cur = routeBullets[ds.id];
      const lineId = cur?.lineId ?? null;
      if (lineId && !e.shiftKey) {
        // Reuse the station snap engine in bullet mode — it already handles
        // per-stop axis alignment, two-axis corner snap, and the "third in-line
        // station" opposite-direction guide. In a group drag, co-selected
        // stations are excluded (they move with the grab); stationary stations
        // stay valid targets.
        const snap = snapDraggedStation({
          proposedX: nx,
          proposedY: ny,
          stations,
          lines,
          tolerance: BULLET_SNAP_TOLERANCE / zoom,
          bulletLineId: lineId,
          excludedIds: ds.siblingStationIds.size > 0 ? ds.siblingStationIds : undefined,
          modes: snapModes,
          gridInterval: gridSize,
        });
        nx = snap.x;
        ny = snap.y;
        setItemSnapGuides(snap.guides);
      } else {
        if (itemSnapGuides.length > 0) setItemSnapGuides([]);
        // Grid-snap fallback when the snap engine wasn't called (unbound
        // bullet). Shift still bypasses.
        if (snapModes.grid !== 'off' && !e.shiftKey) {
          const g = snapPointToGrid(nx, ny, snapModes.grid, gridSize);
          nx = g.x;
          ny = g.y;
        }
      }
      moveRouteBullet(ds.id, nx, ny);
    } else {
      // Labels snap like polygons/images: the topmost-then-leftmost visible
      // (rotated, unpadded) corner aligns against the shared pool, with grid
      // as the hard constraint. Shift bypasses.
      let guides: SnapGuide[] = [];
      if (!e.shiftKey) {
        const snap = snapPolygonPoint({
          proposed: { x: nx + ds.anchorOff.x, y: ny + ds.anchorOff.y },
          lineTargets: [],
          allTargets: ds.allTargets,
          modes: snapModes,
          tolerance: SNAP_PERP_TOLERANCE / zoom,
          gridInterval: gridSize,
        });
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
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
