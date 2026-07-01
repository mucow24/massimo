import { RefObject, useCallback, useRef, useState } from 'react';
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
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import {
  computeGhosts,
  findDropTarget,
  nearestNode,
  sameCell,
  type DropTarget,
  type WidthNode,
} from '../inspector/stopGridDrag';
import { finishDrag, trackDragMove } from './dragGesture';

type ScreenToWorld = (mx: number, my: number) => Vec2;

// Same snap rules as the StopGrid: cursor→ghost radius, and the base swap
// radius a default-width stop reproduces via swapRadiusFor.
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
}

/**
 * Drag engine for the on-canvas station layout editor: the StopGrid's
 * gestures at world scale. Drag a stop/label handle between ghost-lattice
 * slots (Shift = diagonal basis); dropping a stop on another stop swaps
 * them (labels never swap); a no-move click selects the stop/label
 * sub-selection (arming the shape/size pickers and keyboard nudge). Mirror
 * matching fans out to the matches captured at gesture START (a late
 * capture would fail — the first write to the source dissolves the match).
 * One history entry per gesture (dragGesture lifecycle).
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
  const dragRef = useRef<{
    id: StationId;
    source: LayoutDragSource;
    startMX: number;
    startMY: number;
    moved: boolean;
    targets: { id: StationId; layoutOffset: LayoutOffset }[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);

  const onStartNodeDrag = useCallback(
    (id: StationId, source: LayoutDragSource, e: React.PointerEvent) => {
      const doc = useDoc.getState();
      if (!doc.stations[id]) return;
      const matches = useSelection.getState().mirrorMatching
        ? findMatchingStations({ stations: doc.stations, lines: doc.lines }, id)
        : [];
      dragRef.current = {
        id,
        source,
        startMX: e.clientX,
        startMY: e.clientY,
        moved: false,
        targets: [
          { id, layoutOffset: 0 },
          ...matches.map((m) => ({ id: m.id, layoutOffset: m.layoutOffset })),
        ],
        history: beginHistoryGroup(),
      };
    },
    [],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const { moved } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    const doc = useDoc.getState();
    const st = doc.stations[ds.id];
    if (!st) return;
    const rotation = (st.rotation % 8) as Rotation;

    const world = screenToWorld(e.clientX, e.clientY);
    const local = worldDirToLocal({ x: world.x - st.x, y: world.y - st.y }, rotation);
    const cursor: RowCol = { row: local.y / STOP_SIZE, col: local.x / STOP_SIZE };

    const isLabel = ds.source.kind === 'label';
    const sourceCell = isLabel
      ? { row: st.label.row, col: st.label.col }
      : (() => {
          const cell = st.stops.find(
            (s) => ds.source.kind === 'stop' && s.lineId === ds.source.lineId,
          );
          return cell ? { row: cell.row, col: cell.col } : null;
        })();
    if (!sourceCell) return;
    const wSrc = isLabel
      ? STOP_SIZE
      : lineWidthOf(doc.lines[(ds.source as { lineId: LineId }).lineId]);

    // Non-source nodes: stops (minus a dragged stop) + the label cell (minus
    // a dragged label) — anchor candidates and overlap filters, StopGrid-parity.
    const nodes: (WidthNode & { lineId: LineId | null })[] = [
      ...st.stops.map((s) => ({
        row: s.row,
        col: s.col,
        w: lineWidthOf(doc.lines[s.lineId]),
        lineId: s.lineId as LineId | null,
      })),
      { row: st.label.row, col: st.label.col, w: STOP_SIZE, lineId: null },
    ];
    const otherNodes = nodes.filter((n) =>
      isLabel ? n.lineId !== null : n.lineId !== (ds.source as { lineId: LineId }).lineId,
    );
    const anchor = nearestNode(cursor, otherNodes);
    const ghosts = anchor
      ? computeGhosts({
          wSrc,
          anchor,
          otherNodes,
          basis: e.shiftKey ? 'diagonal' : 'orthogonal',
          stationRotation: rotation,
          gridRadius: GRID_RADIUS,
        })
      : [];
    const over = findDropTarget(
      cursor,
      isLabel
        ? { kind: 'label' }
        : { kind: 'stop', lineId: (ds.source as { lineId: LineId }).lineId },
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
      const sourceCell =
        ds.source.kind === 'label'
          ? { row: st.label.row, col: st.label.col }
          : (() => {
              const cell = st.stops.find(
                (s) => ds.source.kind === 'stop' && s.lineId === ds.source.lineId,
              );
              return cell ? { row: cell.row, col: cell.col } : null;
            })();
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

  return { overlay, onStartNodeDrag, onPointerMove, onPointerUp };
}
