import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { StationId } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
import type { RowCol } from '../../geometry/lattice';
import {
  STOP_SIZE,
  rotateGridDelta,
  worldDirToLocal,
  type Rotation,
} from '../../geometry/orientation';
import { screenDeltaToLabelOffsets } from '../../geometry/labelLayout';
import { resolveOffsetPerp } from '../../model/transforms';
import { lineWidthOf } from '../../model/lineWidth';
import { captureMirrorTargets, type MirrorTarget } from '../../state/mirrorDispatch';
import {
  computeGhosts,
  findDropTarget,
  nearestNode,
  type WidthNode,
} from '../inspector/stopGridDrag';
import { finishDrag, trackDragMove } from './dragGesture';

type ScreenToWorld = (mx: number, my: number) => Vec2;

// Cursor→ghost snap radius in row/col units — same rule as the StopGrid.
const GHOST_SNAP_RADIUS = 1.0;
const GRID_RADIUS = 2;

// Overlay state MapCanvas renders while a station-name drag is in flight:
// the candidate ghost lattice (station-local cells) and the snapped slot.
export interface LabelDragOverlay {
  stationId: StationId;
  /** 'ghost' = coarse cell placement; 'fine' = Alt held, live offset writes. */
  mode: 'ghost' | 'fine';
  ghosts: RowCol[];
  over: RowCol | null;
}

export interface LabelDragApi {
  overlay: LabelDragOverlay | null;
  onStartLabelDrag: (id: StationId, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

type StartOffsets = { offset: number; offsetPerp: number };

/**
 * Drag the painted station name on the main canvas (armed by StationHitArea
 * when the station is the sole selection). Plain drag = coarse cell
 * placement over the same ghost lattice the StopGrid used (Shift toggles
 * the diagonal basis), committed via moveLabel on drop; Alt = fine mode,
 * live-writing setLabelOffset / setLabelOffsetPerp so the text tracks the
 * cursor 1:1 (leaving Alt restores the gesture-start offsets first, so the
 * two modes never compound). Modifier presses re-run the computation even
 * with the cursor stationary (window key listeners), so the lattice basis /
 * fine mode flips the moment Shift/Alt changes.
 *
 * Mirror matching fans out to the matches captured at gesture START —
 * capturing late would fail, because the first write to the source station
 * changes its layout and dissolves the match. Offsets apply as a DELTA per
 * match (each keeps its own hand-tuned base), matching the keyboard
 * Alt-nudge. One history entry per gesture (dragGesture lifecycle).
 */
export function useLabelDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  screenToWorld: ScreenToWorld,
): LabelDragApi {
  const [overlay, setOverlayState] = useState<LabelDragOverlay | null>(null);
  // The pointerup commit reads the overlay through this ref, not the state:
  // React 18 batches the last setOverlayState, so on a fast move→up the
  // closure state can lag one move behind the true snapped slot.
  const overlayRef = useRef<LabelDragOverlay | null>(null);
  const setOverlay = (v: LabelDragOverlay | null) => {
    overlayRef.current = v;
    setOverlayState(v);
  };
  // screenToWorld is a FRESH closure every render (it closes over that
  // render's committed viewport). onStartLabelDrag must stay referentially
  // stable for the memoized StationViews, so it reads the projection through
  // this ref — capturing the prop directly in a []-dep callback would freeze
  // the mount-time camera and teleport the label after any pan/zoom.
  const screenToWorldRef = useRef(screenToWorld);
  useEffect(() => {
    screenToWorldRef.current = screenToWorld;
  }, [screenToWorld]);
  const dragRef = useRef<{
    id: StationId;
    startMX: number;
    startMY: number;
    moved: boolean;
    startWorld: Vec2;
    // Latest pointer position — modifier-key presses recompute from it.
    lastMX: number;
    lastMY: number;
    // Source first, then mirror matches — the fan-out targets for the whole
    // gesture. layoutOffset rotates cell deltas into each match's frame.
    targets: MirrorTarget[];
    // Per-target gesture-start offsets: the base for delta application and
    // the restore point when leaving Alt mode.
    startOffsets: Map<StationId, StartOffsets>;
    offsetsDirty: boolean;
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);

  const onStartLabelDrag = useCallback((id: StationId, e: React.PointerEvent) => {
    const doc = useDoc.getState();
    const st = doc.stations[id];
    if (!st) return;
    const targets = captureMirrorTargets(id);
    const startOffsets = new Map<StationId, StartOffsets>();
    for (const t of targets) {
      const s = doc.stations[t.id];
      if (s) {
        startOffsets.set(t.id, {
          offset: s.label.offset,
          offsetPerp: resolveOffsetPerp(s.label),
        });
      }
    }
    dragRef.current = {
      id,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      startWorld: screenToWorldRef.current(e.clientX, e.clientY),
      lastMX: e.clientX,
      lastMY: e.clientY,
      targets,
      startOffsets,
      offsetsDirty: false,
      history: beginHistoryGroup(),
    };
  }, []);

  const restoreOffsets = (ds: NonNullable<typeof dragRef.current>) => {
    const doc = useDoc.getState();
    for (const t of ds.targets) {
      const start = ds.startOffsets.get(t.id);
      if (!start) continue;
      doc.setLabelOffset(t.id, start.offset);
      doc.setLabelOffsetPerp(t.id, start.offsetPerp);
    }
    ds.offsetsDirty = false;
  };

  // The whole per-frame computation, parameterized so both pointermove and a
  // stationary modifier press can drive it. Reads only refs + live stores.
  const update = (clientX: number, clientY: number, altKey: boolean, shiftKey: boolean) => {
    const ds = dragRef.current;
    if (!ds || !ds.moved) return;
    ds.lastMX = clientX;
    ds.lastMY = clientY;
    const doc = useDoc.getState();
    const st = doc.stations[ds.id];
    if (!st) return;
    const rotation = (st.rotation % 8) as Rotation;

    if (altKey) {
      // Fine mode: offsets from the gesture-start world delta, decomposed
      // onto the label's reading axes — the text tracks the cursor exactly.
      // Applied as a DELTA per target so each mirror match keeps its own
      // hand-tuned base offsets.
      const world = screenToWorldRef.current(clientX, clientY);
      const { dOffset, dPerp } = screenDeltaToLabelOffsets(
        { x: world.x - ds.startWorld.x, y: world.y - ds.startWorld.y },
        rotation,
        st.label.rotation,
      );
      for (const t of ds.targets) {
        const start = ds.startOffsets.get(t.id);
        if (!start) continue;
        doc.setLabelOffset(t.id, start.offset + dOffset);
        doc.setLabelOffsetPerp(t.id, start.offsetPerp + dPerp);
      }
      ds.offsetsDirty = true;
      setOverlay({ stationId: ds.id, mode: 'fine', ghosts: [], over: null });
      return;
    }

    // Ghost mode. If a previous Alt phase wrote offsets, undo it first so
    // the two modes never compound within one gesture.
    if (ds.offsetsDirty) restoreOffsets(ds);
    const world = screenToWorldRef.current(clientX, clientY);
    const local = worldDirToLocal({ x: world.x - st.x, y: world.y - st.y }, rotation);
    const cursor: RowCol = { row: local.y / STOP_SIZE, col: local.x / STOP_SIZE };
    const stopNodes: WidthNode[] = st.stops.map((s) => ({
      row: s.row,
      col: s.col,
      w: lineWidthOf(doc.lines[s.lineId]),
    }));
    const anchor = nearestNode(cursor, stopNodes);
    const ghosts = anchor
      ? computeGhosts({
          wSrc: STOP_SIZE,
          anchor,
          otherNodes: stopNodes,
          basis: shiftKey ? 'diagonal' : 'orthogonal',
          stationRotation: rotation,
          gridRadius: GRID_RADIUS,
        })
      : [];
    const over = findDropTarget(cursor, { kind: 'label' }, [], ghosts, {
      swapRadius: 0,
      snapRadius: GHOST_SNAP_RADIUS,
    });
    setOverlay({
      stationId: ds.id,
      mode: 'ghost',
      ghosts,
      over: over ? { row: over.row, col: over.col } : null,
    });
  };
  // Latest `update` for the window key listeners (assigned in an effect —
  // writing a ref during render trips react-hooks/refs).
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  });

  // Stationary modifier tracking: Shift flips the lattice basis and Alt
  // enters/leaves fine mode the moment the key changes, without waiting for
  // the next pointermove (parity with the StopGrid's useShiftHeld).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Alt') return;
      const ds = dragRef.current;
      if (!ds || !ds.moved) return;
      // Keep a mid-drag Alt press from focusing the browser menu bar.
      if (e.key === 'Alt' && e.type === 'keydown') e.preventDefault();
      updateRef.current(ds.lastMX, ds.lastMY, e.altKey, e.shiftKey);
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
    update(e.clientX, e.clientY, e.altKey, e.shiftKey);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    const finalOverlay = overlayRef.current;
    setOverlay(null);
    if (ds.moved) {
      const doc = useDoc.getState();
      const st = doc.stations[ds.id];
      if (st && ds.offsetsDirty) {
        // Fine mode ended the gesture: keep each target's live offsets,
        // rounded to integers so the inspector's number fields stay tidy.
        for (const t of ds.targets) {
          const cur = doc.stations[t.id];
          if (!cur) continue;
          doc.setLabelOffset(t.id, Math.round(cur.label.offset));
          doc.setLabelOffsetPerp(t.id, Math.round(resolveOffsetPerp(cur.label)));
        }
      } else if (st && finalOverlay?.mode === 'ghost' && finalOverlay.over) {
        const dRow = finalOverlay.over.row - st.label.row;
        const dCol = finalOverlay.over.col - st.label.col;
        for (const t of ds.targets) {
          const d = rotateGridDelta(dRow, dCol, t.layoutOffset);
          doc.moveLabel(t.id, d.dRow, d.dCol);
        }
      }
      // Arm the label sub-selection so arrow-key nudging continues from the
      // drop. (A no-move click arms it via StationHitArea's click handler.)
      useSelection.getState().setLabelSelected(true);
    }
    finishDrag(ds, e, svgRef);
  };

  return { overlay, onStartLabelDrag, onPointerMove, onPointerUp };
}
