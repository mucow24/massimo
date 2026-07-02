import { RefObject, useRef } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import {
  closestParamOnOffsetPath,
  offsetPathLength,
  snapNeighborTag,
} from '../../geometry/lineTagGeometry';
import { buildBands, SegmentBandSpec } from '../../geometry/interlining';
import { finishDrag, trackDragMove } from './dragGesture';

export interface LineTagDragApi {
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  // pointermove/up are wired via global captures in this hook (it grabs the
  // svg pointer capture on first significant motion).
}

// World arc-length units along the centerline (deliberately NOT ÷ zoom,
// unlike the other hooks' screen-px snap radii).
const SNAP_TOL = 10;

/**
 * Drag handler for line tags. Mirrors useStationDrag's lifecycle:
 * pointerdown captures pre-drag state, threshold of 4 screen px before
 * registering a drag, pointermove projects cursor onto the line's path
 * across all segments + snaps to neighbouring tags in the same band,
 * pointerup commits one history entry.
 */
export function useLineTagDrag(svgRef: RefObject<SVGSVGElement | null>): LineTagDragApi {
  const moveLineTag = useDoc((s) => s.moveLineTag);

  const dragRef = useRef<{
    tagId: string;
    startMX: number;
    startMY: number;
    moved: boolean;
    history: ReturnType<typeof beginHistoryGroup>;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
    onCancel: () => void;
  } | null>(null);

  const onStartDrag = (id: string, e: React.PointerEvent) => {
    const onMove = (ev: PointerEvent) => onPointerMove(ev);
    const onUp = (ev: PointerEvent) => onPointerUp(ev);
    const onCancel = () => onPointerCancel();
    dragRef.current = {
      tagId: id,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup(),
      onMove,
      onUp,
      onCancel,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const onPointerMove = (e: PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    // Shared threshold/capture/suppress-click; native PointerEvents satisfy the
    // structural pointer shape, so the same primitive backs this window-level
    // drag and the React-handler hooks.
    const { moved } = trackDragMove(ds, e, svgRef);
    if (!moved) return;

    const docState = useDoc.getState();
    const tag = docState.lineTags[ds.tagId];
    if (!tag) return;
    const line = docState.lines[tag.lineId];
    if (!line) return;

    // Convert pointer to world coords. We have the svg ref + zoom, but the
    // viewport offset must be derived from the svg's CTM.
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const world = pt.matrixTransform(inv);
    const target = { x: world.x, y: world.y };

    // Recompute bands fresh — buildBands is pure & memo'd at the canvas, but
    // here we just need the latest geometry. Cheap relative to drag latency.
    const bands = buildBands(
      docState.stations,
      docState.lines,
      docState.curveRadius,
      docState.lineOrder,
    );

    // Build candidate set: every consecutive station-pair on the line.
    type Cand = {
      band: SegmentBandSpec;
      offset: number;
      pairKey: string;
      fromStationId: StationId;
      toStationId: StationId;
      forward: boolean;
      // tCanon ∈ [0,1] along canonical centerline.
      tCanon: number;
      dist: number;
    };
    let best: Cand | null = null;
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      const forward = a < b;
      const fromCanon = forward ? a : b;
      const toCanon = forward ? b : a;
      const pairKey = pairKeyOf(a, b);
      const band = bands.find(
        (bb) => bb.pairKey === pairKey && bb.lines.some((l: { id: LineId }) => l.id === tag.lineId),
      );
      if (!band) continue;
      const k = band.lines.findIndex((l: { id: LineId }) => l.id === tag.lineId);
      const offset = band.stripeOffsets[k];
      const r = closestParamOnOffsetPath(band.centerline, band.radius, offset, target);
      if (!best || r.dist < best.dist) {
        best = {
          band,
          offset,
          pairKey,
          fromStationId: fromCanon,
          toStationId: toCanon,
          forward,
          tCanon: r.t,
          dist: r.dist,
        };
      }
    }
    if (!best) return;

    // Snap to a neighbor tag in the same corridor (any line, any stripe).
    // Pure helper converts each neighbor's (anchorEnd, distance) to a
    // canonical-t using THAT neighbor's own stripe length.
    const snap = snapNeighborTag({
      candCanonT: best.tCanon,
      candPairKey: best.pairKey,
      selfTagId: ds.tagId,
      bandCenterline: best.band.centerline,
      curveRadius: best.band.radius,
      lineStripeOffset: (lineId) => {
        const idx = best.band.lines.findIndex((l: { id: LineId }) => l.id === lineId);
        if (idx < 0) return null;
        return best.band.stripeOffsets[idx];
      },
      lineTags: docState.lineTags,
      tol: SNAP_TOL,
    });

    // Convert resolved canonical-t to (anchorEnd, distance) on the dragged
    // tag's stripe. Anchor follows the nearer endpoint at the new position.
    const stripeTotal = offsetPathLength(best.band.centerline, best.band.radius, best.offset);
    const arcLen = snap.canonT * stripeTotal;
    const anchorEnd: 'from' | 'to' = arcLen <= stripeTotal / 2 ? 'from' : 'to';
    const distance = anchorEnd === 'from' ? arcLen : stripeTotal - arcLen;
    moveLineTag(ds.tagId, best.fromStationId, best.toStationId, anchorEnd, distance);
  };

  const onPointerUp = (e: PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    window.removeEventListener('pointermove', ds.onMove);
    window.removeEventListener('pointerup', ds.onUp);
    window.removeEventListener('pointercancel', ds.onCancel);
    dragRef.current = null;
    // Shared commit/cancel: one history entry + capture release + click-suppress
    // clear when the gesture moved, else cancel (a pure click).
    finishDrag(ds, e, svgRef);
  };

  // A browser pointercancel (pen palm rejection, window switch, capture loss)
  // ends the gesture with no pointerup. This hook is window-wired, so
  // MapCanvas's pointercancel fan-out can't reach it — it disarms itself:
  // unhook the window listeners (a stray later move must not keep dragging a
  // button-less tag) and roll the live moveLineTag writes back to the pre-drag
  // snapshot without committing.
  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    window.removeEventListener('pointermove', ds.onMove);
    window.removeEventListener('pointerup', ds.onUp);
    window.removeEventListener('pointercancel', ds.onCancel);
    dragRef.current = null;
    ds.history.rollback();
  };

  return { onStartDrag };
}
