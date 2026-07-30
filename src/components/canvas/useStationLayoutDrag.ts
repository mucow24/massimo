import { RefObject, useCallback, useEffect } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
import type { RowCol } from '../../geometry/lattice';
import { STOP_SIZE, rotateGridDelta, type Rotation } from '../../geometry/orientation';
import { stationCircle } from '../../geometry/lineCircle';
import { lineInterlineGapOf, lineWidthOf } from '../../model/lineWidth';
import { captureMirrorTargets, type MirrorTarget } from '../../state/mirrorDispatch';
import {
  anchorBlockerNodes,
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

export type LayoutDragSource =
  | { kind: 'stop'; lineId: LineId }
  | { kind: 'label' }
  | { kind: 'anchor'; anchorId: string };

// Overlay state for the editing-station-layout mode: the in-flight drag's
// candidate ghost lattice + the resolved drop target (ghost slot or swap).
export interface LayoutDragOverlay {
  stationId: StationId;
  source: LayoutDragSource;
  ghosts: RowCol[];
  over: DropTarget | null;
}

/**
 * Arm the grabbed node as the station's sub-selection — the three fields are
 * mutually exclusive, and each of the three setters clears the other two.
 * Shared by the no-move click and the post-drop path so they can't disagree.
 */
function armLayoutNode(sel: ReturnType<typeof useSelection.getState>, source: LayoutDragSource) {
  if (source.kind === 'stop') sel.setSelectedStopLineId(source.lineId);
  else if (source.kind === 'anchor') sel.setSelectedAnchorCellId(source.anchorId);
  else sel.setLabelSelected(true);
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
        history: beginHistoryGroup({ deferPersist: true }),
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

    // Cells were placed through the station's FRAME, so the cursor reads back
    // through it too — a ring's, not the rounded octant (see stationDirToLocal).
    const cursor = cursorCellAt(
      st,
      screenToWorldRef.current(clientX, clientY),
      stationCircle(st, doc.lineCircles),
    );

    const sourceCell = sourceCellOf(st, ds.source);
    if (!sourceCell) return;
    // A hosted anchor takes the LABEL's parameters exactly: unit nominal width
    // (so ring-1 lands a full cell out from a default-width stop) and no
    // interline gap, with srcIsPoint making it body-less for the overlap check.
    const isPoint = ds.source.kind !== 'stop';
    const wSrc = ds.source.kind === 'stop' ? lineWidthOf(doc.lines[ds.source.lineId]) : STOP_SIZE;
    const gSrc = ds.source.kind === 'stop' ? lineInterlineGapOf(doc.lines[ds.source.lineId]) : 0;
    const otherNodes = [
      ...otherLayoutNodes(stationLayoutNodes(st, doc.lines), ds.source),
      // Anchors block slots without being lattice nodes (see anchorBlockerNodes).
      ...anchorBlockerNodes(st, ds.source.kind === 'anchor' ? ds.source.anchorId : undefined),
    ];
    const { ghosts } = dragLattice({
      cursor,
      wSrc,
      gSrc,
      srcIsPoint: isPoint,
      otherNodes,
      basis: shiftKey ? 'diagonal' : 'orthogonal',
      stationRotation: rotation,
    });
    const over = findDropTarget(
      cursor,
      ds.source.kind === 'stop'
        ? { kind: 'stop', lineId: ds.source.lineId }
        : // Neither the label nor an anchor ever SWAPS with a stop; naming the
          // kind honestly keeps findDropTarget's parameter from lying.
          { kind: ds.source.kind },
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
      armLayoutNode(sel, ds.source);
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
        if (ds.source.kind === 'anchor') {
          // NO mirror fan-out: an anchor id is globally unique and lives on
          // exactly this station, so there is no per-target counterpart for a
          // matched station to move (matching.ts's stopsKey ignores anchors —
          // a mirror match need not own one at all). Applying the source's
          // delta once, unrotated, to the single station that hosts the anchor
          // is the whole move.
          doc.moveStationAnchor(ds.id, ds.source.anchorId, dRow, dCol);
        } else {
          for (const t of ds.targets) {
            const d = rotateGridDelta(dRow, dCol, t.layoutOffset);
            if (ds.source.kind === 'stop') doc.moveStop(t.id, ds.source.lineId, d.dRow, d.dCol);
            else doc.moveLabel(t.id, d.dRow, d.dCol);
          }
        }
      }
      // Keep the dragged node armed as the sub-selection after the drop.
      armLayoutNode(sel, ds.source);
    }
    finishDrag(ds, e, svgRef);
  };

  return { overlay, onStartNodeDrag, onPointerMove, onPointerUp, onPointerCancel };
}
