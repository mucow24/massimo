import { RefObject, useRef } from 'react';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import {
  closestParamOnOffsetPath,
  offsetPathLength,
  snapNeighborTag,
} from '../../geometry/lineTagGeometry';
import { STOP_SIZE } from '../../geometry/orientation';
import { buildBands, SegmentBandSpec } from '../../geometry/interlining';

export interface LineTagDragApi {
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  // pointermove/up are wired via global captures in this hook (it grabs the
  // svg pointer capture on first significant motion).
}

const SNAP_TOL = 10; // world px

/**
 * Drag handler for line tags. Mirrors useStationDrag's lifecycle:
 * pointerdown captures pre-drag state, threshold of 4 screen px before
 * registering a drag, pointermove projects cursor onto the line's path
 * across all segments + snaps to neighbouring tags in the same band,
 * pointerup commits one history entry.
 */
export function useLineTagDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): LineTagDragApi {
  const moveLineTag = useDoc((s) => s.moveLineTag);

  const dragRef = useRef<{
    tagId: string;
    startMX: number;
    startMY: number;
    moved: boolean;
    history: ReturnType<typeof beginHistoryGroup>;
    pointerId: number;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null>(null);

  const onStartDrag = (id: string, e: React.PointerEvent) => {
    const onMove = (ev: PointerEvent) => onPointerMove(ev);
    const onUp = (ev: PointerEvent) => onPointerUp(ev);
    dragRef.current = {
      tagId: id,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup(),
      pointerId: e.pointerId,
      onMove,
      onUp,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onPointerMove = (e: PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dxScreen = e.clientX - ds.startMX;
    const dyScreen = e.clientY - ds.startMY;
    if (!ds.moved && Math.hypot(dxScreen, dyScreen) > 4) {
      ds.moved = true;
      dragState.suppressClick = true;
      try {
        svgRef.current?.setPointerCapture(ds.pointerId);
      } catch {
        // ignored
      }
    }
    if (!ds.moved) return;

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
      const pairKey = `${fromCanon}|${toCanon}`;
      const band = bands.find(
        (bb) => bb.pairKey === pairKey && bb.lines.some((l: { id: LineId }) => l.id === tag.lineId),
      );
      if (!band) continue;
      const k = band.lines.findIndex((l: { id: LineId }) => l.id === tag.lineId);
      const n = band.lines.length;
      const offset = (k - (n - 1) / 2) * STOP_SIZE;
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
        const n = best.band.lines.length;
        return (idx - (n - 1) / 2) * STOP_SIZE;
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
    const wasMoved = ds.moved;
    window.removeEventListener('pointermove', ds.onMove);
    window.removeEventListener('pointerup', ds.onUp);
    dragRef.current = null;
    if (!wasMoved) {
      ds.history.cancel();
      return;
    }
    ds.history.commit();
    try {
      svgRef.current?.releasePointerCapture(ds.pointerId);
    } catch {
      // ignored
    }
    setTimeout(() => {
      dragState.suppressClick = false;
    }, 0);
    void e;
  };

  // Suppress unused parameter warnings — viewportZoom is a hint that caller
  // tracks the value, but the drag uses CTM to convert pointer coords.
  void viewportZoom;
  void useSelection;

  return { onStartDrag };
}
