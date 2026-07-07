import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import {
  snapDraggedStation,
  snapLabelToGrid,
  snapPointToGrid,
  type SnapGuide,
} from '../../geometry/snap';
import { measureTextLabel } from '../../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../../geometry/stationBoundary';
import { finishDrag, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';

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
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface ItemDragApi {
  bulletSnapGuides: SnapGuide[];
  onBulletPointerDown: (id: string, e: React.PointerEvent) => void;
  onLabelPointerDown: (id: string, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Owns drag state for the free-floating items — route bullets and text labels —
 * with a single gesture state machine for both. They differ only in their
 * per-frame snap: a bullet reuses the station snap engine in bullet mode (with
 * a grid fallback); a label grid-snaps its visible upper-left corner. The drag
 * lifecycle (threshold, capture, click suppression, one history entry) and the
 * multi-selection sibling towing are shared via dragGesture + groupDrag.
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
  const [bulletSnapGuides, setBulletSnapGuides] = useState<SnapGuide[]>([]);

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
        setBulletSnapGuides(snap.guides);
      } else {
        if (bulletSnapGuides.length > 0) setBulletSnapGuides([]);
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
      // Labels don't go through the snap engine (no axis/orientation), but grid
      // snap still applies. Register the label by its visible upper-left bbox
      // corner (incl. hit padding) so the edge the user sees lands on a grid line.
      if (snapModes.grid !== 'off' && !e.shiftKey) {
        const cur = textLabels[ds.id];
        if (cur) {
          const m = measureTextLabel(cur);
          const snapped = snapLabelToGrid(
            { x: nx, y: ny },
            m.width + 2 * TEXT_LABEL_HIT_PAD,
            m.height + 2 * TEXT_LABEL_HIT_PAD,
            snapModes.grid,
            gridSize,
          );
          nx = snapped.x;
          ny = snapped.y;
        }
      }
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
    setBulletSnapGuides([]);
    finishDrag(ds, e, svgRef);
  };

  // Browser pointercancel: disarm the drag and roll the doc back to its
  // pre-drag snapshot (reverting the live move + any towed siblings) instead of
  // committing. See useStationDrag for the full rationale.
  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setBulletSnapGuides([]);
    ds.history.rollback();
  };

  return {
    bulletSnapGuides,
    onBulletPointerDown,
    onLabelPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
