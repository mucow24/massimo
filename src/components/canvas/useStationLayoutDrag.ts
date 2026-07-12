import { RefObject, useCallback, useEffect } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
import type { RowCol } from '../../geometry/lattice';
import { STOP_SIZE, rotateGridDelta, type Rotation } from '../../geometry/orientation';
import { lineWidthOf } from '../../model/lineWidth';
import { captureMirrorTargets, type MirrorTarget } from '../../state/mirrorDispatch';
import {
  GHOST_SNAP_RADIUS,
  cursorCellAt,
  dragLattice,
  findDropTarget,
  otherLayoutNodes,
  sameCell,
  sourceCellOf,
  stationLayoutNodes,
  type DropTarget,
} from '../inspector/stopGridDrag';
import { finishDrag } from './dragGesture';
import { useGhostDragEngine, type DragModifiers, type GhostDragCore } from './useGhostDragEngine';

type ScreenToWorld = (mx: number, my: number) => Vec2;

// The base swap radius a default-width stop reproduces via swapRadiusFor —
// same rule as the old StopGrid.
const STOP_SWAP_RADIUS = 0.6;

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

interface LayoutDragState extends GhostDragCore {
  id: StationId;
  source: LayoutDragSource;
  targets: MirrorTarget[];
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
 *
 * Lifecycle scaffolding (overlay ref mirror, live projection ref, stationary
 * modifier recompute, pointermove/pointercancel) lives in useGhostDragEngine.
 */
export function useStationLayoutDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  screenToWorld: ScreenToWorld,
): StationLayoutDragApi {
  const {
    overlay,
    overlayRef,
    setOverlay,
    dragRef,
    screenToWorldRef,
    updateRef,
    onPointerMove,
    onPointerCancel,
  } = useGhostDragEngine<LayoutDragState, LayoutDragOverlay>(svgRef, screenToWorld);

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
    [dragRef],
  );

  // The per-frame computation, driven by pointermove and stationary Shift
  // presses (engine). Reads only refs + live stores.
  const update = (clientX: number, clientY: number, { shiftKey }: DragModifiers) => {
    const ds = dragRef.current;
    if (!ds || !ds.moved) return;
    ds.lastMX = clientX;
    ds.lastMY = clientY;
    const doc = useDoc.getState();
    const st = doc.stations[ds.id];
    if (!st) return;
    const rotation = (st.rotation % 8) as Rotation;

    const cursor = cursorCellAt(st, rotation, screenToWorldRef.current(clientX, clientY));

    const sourceCell = sourceCellOf(st, ds.source);
    if (!sourceCell) return;
    const wSrc = ds.source.kind === 'label' ? STOP_SIZE : lineWidthOf(doc.lines[ds.source.lineId]);
    const otherNodes = otherLayoutNodes(stationLayoutNodes(st, doc.lines), ds.source);
    const { ghosts } = dragLattice({
      cursor,
      wSrc,
      srcIsLabel: ds.source.kind === 'label',
      otherNodes,
      basis: shiftKey ? 'diagonal' : 'orthogonal',
      stationRotation: rotation,
    });
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
  useEffect(() => {
    updateRef.current = update;
  });

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

  return { overlay, onStartNodeDrag, onPointerMove, onPointerUp, onPointerCancel };
}
