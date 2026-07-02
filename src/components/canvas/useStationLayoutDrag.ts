import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
import type { RowCol } from '../../geometry/lattice';
import {
  STOP_SIZE,
  rotateGridDelta,
  worldDirToLocal,
  type Rotation,
} from '../../geometry/orientation';
import { lineWidthOf } from '../../model/lineWidth';
import { captureMirrorTargets, type MirrorTarget } from '../../state/mirrorDispatch';
import {
  computeGhosts,
  findDropTarget,
  nearestNode,
  otherLayoutNodes,
  sameCell,
  sourceCellOf,
  stationLayoutNodes,
  type DropTarget,
} from '../inspector/stopGridDrag';
import { finishDrag, trackDragMove } from './dragGesture';

type ScreenToWorld = (mx: number, my: number) => Vec2;

// Same snap rules as the old StopGrid: cursor→ghost radius, and the base
// swap radius a default-width stop reproduces via swapRadiusFor.
const GHOST_SNAP_RADIUS = 1.0;
const STOP_SWAP_RADIUS = 0.6;
const GRID_RADIUS = 2;

export type LayoutDragSource = { kind: 'stop'; lineId: LineId } | { kind: 'label' };

// Overlay state for the editing-station-layout mode: the in-flight drag's
// candidate ghost lattice + the resolved drop target (ghost slot or swap).
export interface LayoutDragOverlay {
  stationId: StationId;
  source: LayoutDragSource;
  ghosts: RowCol[];
  over: DropTarget | null;
}

export interface StationLayoutDragApi {
  overlay: LayoutDragOverlay | null;
  onStartNodeDrag: (id: StationId, source: LayoutDragSource, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Drag engine for the on-canvas station layout editor: the StopGrid's
 * gestures at world scale. Drag a stop/label handle between ghost-lattice
 * slots (Shift = diagonal basis, flipping immediately on a stationary
 * press); dropping a stop on another stop swaps them (labels never swap); a
 * no-move click selects the stop/label sub-selection (arming the shape/size
 * pickers and keyboard nudge). Mirror matching fans out to the matches
 * captured at gesture START (a late capture would fail — the first write to
 * the source dissolves the match). One history entry per gesture.
 */
export function useStationLayoutDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  screenToWorld: ScreenToWorld,
): StationLayoutDragApi {
  const [overlay, setOverlayState] = useState<LayoutDragOverlay | null>(null);
  // The pointerup commit reads the overlay through this ref, not the state —
  // React 18 batches the last set, so closure state can lag one move behind.
  const overlayRef = useRef<LayoutDragOverlay | null>(null);
  const setOverlay = (v: LayoutDragOverlay | null) => {
    overlayRef.current = v;
    setOverlayState(v);
  };
  // Fresh-projection ref: screenToWorld is a new closure every render (it
  // closes over that render's committed viewport); the []-stable handlers
  // and the window key listeners read it through here.
  const screenToWorldRef = useRef(screenToWorld);
  useEffect(() => {
    screenToWorldRef.current = screenToWorld;
  }, [screenToWorld]);
  const dragRef = useRef<{
    id: StationId;
    source: LayoutDragSource;
    startMX: number;
    startMY: number;
    moved: boolean;
    lastMX: number;
    lastMY: number;
    targets: MirrorTarget[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);

  const onStartNodeDrag = useCallback(
    (id: StationId, source: LayoutDragSource, e: React.PointerEvent) => {
      if (!useDoc.getState().stations[id]) return;
      dragRef.current = {
        id,
        source,
        startMX: e.clientX,
        startMY: e.clientY,
        moved: false,
        lastMX: e.clientX,
        lastMY: e.clientY,
        targets: captureMirrorTargets(id),
        history: beginHistoryGroup(),
      };
    },
    [],
  );

  // The per-frame computation, parameterized so both pointermove and a
  // stationary Shift press can drive it. Reads only refs + live stores.
  const update = (clientX: number, clientY: number, shiftKey: boolean) => {
    const ds = dragRef.current;
    if (!ds || !ds.moved) return;
    ds.lastMX = clientX;
    ds.lastMY = clientY;
    const doc = useDoc.getState();
    const st = doc.stations[ds.id];
    if (!st) return;
    const rotation = (st.rotation % 8) as Rotation;

    const world = screenToWorldRef.current(clientX, clientY);
    const local = worldDirToLocal({ x: world.x - st.x, y: world.y - st.y }, rotation);
    const cursor: RowCol = { row: local.y / STOP_SIZE, col: local.x / STOP_SIZE };

    const sourceCell = sourceCellOf(st, ds.source);
    if (!sourceCell) return;
    const wSrc = ds.source.kind === 'label' ? STOP_SIZE : lineWidthOf(doc.lines[ds.source.lineId]);
    const otherNodes = otherLayoutNodes(stationLayoutNodes(st, doc.lines), ds.source);
    const anchor = nearestNode(cursor, otherNodes);
    const ghosts = anchor
      ? computeGhosts({
          wSrc,
          anchor,
          otherNodes,
          basis: shiftKey ? 'diagonal' : 'orthogonal',
          stationRotation: rotation,
          gridRadius: GRID_RADIUS,
        })
      : [];
    const over = findDropTarget(
      cursor,
      ds.source.kind === 'label' ? { kind: 'label' } : { kind: 'stop', lineId: ds.source.lineId },
      st.stops,
      ghosts,
      {
        swapRadius: STOP_SWAP_RADIUS,
        snapRadius: GHOST_SNAP_RADIUS,
        // Wider stops draw bigger; "on the circle" scales with them.
        swapRadiusFor: (s) => lineWidthOf(doc.lines[s.lineId]) / (2 * STOP_SIZE) + 0.1,
      },
    );
    setOverlay({ stationId: ds.id, source: ds.source, ghosts, over });
  };
  // Latest `update` for the window key listeners (assigned in an effect —
  // writing a ref during render trips react-hooks/refs).
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  });

  // Stationary Shift tracking: flip the lattice basis the moment the key
  // changes, without waiting for the next pointermove (StopGrid parity).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      const ds = dragRef.current;
      if (!ds || !ds.moved) return;
      updateRef.current(ds.lastMX, ds.lastMY, e.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const { moved } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    update(e.clientX, e.clientY, e.shiftKey);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    const finalOverlay = overlayRef.current;
    setOverlay(null);
    const sel = useSelection.getState();
    if (!ds.moved) {
      // Pure click: select the grabbed node (StopGrid parity).
      if (ds.source.kind === 'stop') sel.setSelectedStopLineId(ds.source.lineId);
      else sel.setLabelSelected(true);
      finishDrag(ds, e, svgRef); // cancels the empty history group
      return;
    }
    const doc = useDoc.getState();
    const st = doc.stations[ds.id];
    const over = finalOverlay?.over ?? null;
    if (st && over) {
      const sourceCell = sourceCellOf(st, ds.source);
      if (sourceCell && !sameCell(over, sourceCell)) {
        const dRow = over.row - sourceCell.row;
        const dCol = over.col - sourceCell.col;
        for (const t of ds.targets) {
          const d = rotateGridDelta(dRow, dCol, t.layoutOffset);
          if (ds.source.kind === 'stop') doc.moveStop(t.id, ds.source.lineId, d.dRow, d.dCol);
          else doc.moveLabel(t.id, d.dRow, d.dCol);
        }
      }
      // Keep the dragged node armed as the sub-selection after the drop.
      if (ds.source.kind === 'stop') sel.setSelectedStopLineId(ds.source.lineId);
      else sel.setLabelSelected(true);
    }
    finishDrag(ds, e, svgRef);
  };

  // Browser pointercancel: disarm the drag and clear the overlay, dropping the
  // resolved-but-uncommitted move (this hook writes the doc only on drop, so
  // rollback finds nothing to revert — it just closes the paused history group
  // so recording resumes). See useStationDrag for the full rationale.
  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setOverlay(null);
    ds.history.rollback();
  };

  return { overlay, onStartNodeDrag, onPointerMove, onPointerUp, onPointerCancel };
}
