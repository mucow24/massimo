import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import type { LineId, StationId } from '../../model/types';
import { edgeEndpoints } from '../../model/lineTopology';
import type { SnapGuide } from '../../geometry/snap';
import {
  anchorFromArcLen,
  closestParamOnOffsetPath,
  LINE_TAG_SNAP_TOLERANCE,
  offsetPathLength,
  sampleOffsetPath,
  snapNeighborTag,
} from '../../geometry/lineTagGeometry';
import { buildBands, SegmentBandSpec } from '../../geometry/interlining';
import type { Vec2 } from '../../geometry/vec';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';

type ScreenToWorld = (mx: number, my: number) => Vec2;

export interface LineTagDragApi {
  lineTagSnapGuides: SnapGuide[];
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  // pointermove/up are wired via global captures in this hook (it grabs the
  // svg pointer capture on first significant motion).
}

/**
 * Drag handler for line tags. Mirrors useStationDrag's lifecycle:
 * pointerdown captures pre-drag state, threshold of 4 screen px before
 * registering a drag, pointermove projects cursor onto the line's path
 * across all segments + snaps to the nearest neighbouring tag in the same
 * corridor — always on (an interlined tag naturally lines up with its
 * siblings) and bypassed by Shift, with a labeled guide to the matched
 * neighbor and an engage radius held constant in screen px (tolerance ÷
 * zoom), matching the other drag hooks.
 */
export function useLineTagDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  screenToWorld: ScreenToWorld,
): LineTagDragApi {
  const moveLineTag = useDoc((s) => s.moveLineTag);
  const [lineTagSnapGuides, setLineTagSnapGuides] = useState<SnapGuide[]>([]);

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
      history: beginHistoryGroup({ deferPersist: true }),
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
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move.
    if (pointerLost(e)) return onPointerCancel();
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

    // Cursor → world through the shared viewport helper (same one every other
    // drag hook uses), so this stays in sync with the live, un-committed pan/zoom
    // rather than re-deriving the offset from the svg's CTM.
    const target = screenToWorld(e.clientX, e.clientY);

    // Recompute bands fresh — buildBands is pure & memo'd at the canvas, but
    // here we just need the latest geometry. Cheap relative to drag latency.
    const bands = buildBands(docState.stations, docState.lines, docState.lineOrder);

    // Build candidate set: every EDGE (segment) of the line — its actual
    // topology, so loop wrap-edges and branch legs (which are not consecutive
    // pairs in the display order) are draggable targets too.
    type Cand = {
      band: SegmentBandSpec;
      offset: number;
      pairKey: string;
      fromStationId: StationId;
      toStationId: StationId;
      // tCanon ∈ [0,1] along canonical centerline.
      tCanon: number;
      dist: number;
    };
    let best: Cand | null = null;
    for (const pairKey of line.edges) {
      const [fromCanon, toCanon] = edgeEndpoints(pairKey); // canonical: from < to
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
          tCanon: r.t,
          dist: r.dist,
        };
      }
    }
    if (!best) return;

    // Snap to the nearest neighbor tag in the same corridor (any line, any
    // stripe), aligned by cross-section so it lands directly across from its
    // neighbor even where the band curves. Always on — a tag naturally lines
    // up with its interlined siblings; Shift bypasses.
    const snap = !e.shiftKey
      ? snapNeighborTag({
          candCanonT: best.tCanon,
          candOffset: best.offset,
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
          // Constant screen-pixel engage radius (see useStationDrag).
          tol: LINE_TAG_SNAP_TOLERANCE / zoom,
        })
      : { canonT: best.tCanon, snapped: false as const, match: undefined };

    // Guide to the matched neighbor, with the same rounded-distance label as
    // every other alignment guide (here the cross-stripe gap between the two
    // aligned tags).
    if (snap.snapped && snap.match) {
      const dragged = sampleOffsetPath(
        best.band.centerline,
        best.band.radius,
        best.offset,
        snap.canonT,
      ).p;
      const neighbor = sampleOffsetPath(
        best.band.centerline,
        best.band.radius,
        snap.match.stripeOffset,
        snap.match.canonT,
      ).p;
      setLineTagSnapGuides([
        {
          from: neighbor,
          to: dragged,
          label: Math.round(Math.hypot(dragged.x - neighbor.x, dragged.y - neighbor.y)).toString(),
        },
      ]);
    } else {
      setLineTagSnapGuides([]);
    }

    // Convert resolved canonical-t to (anchorEnd, distance) on the dragged
    // tag's stripe. Anchor follows the nearer endpoint at the new position.
    const stripeTotal = offsetPathLength(best.band.centerline, best.band.radius, best.offset);
    const { anchorEnd, distance } = anchorFromArcLen(snap.canonT * stripeTotal, stripeTotal);
    moveLineTag(ds.tagId, best.fromStationId, best.toStationId, anchorEnd, distance);
  };

  const onPointerUp = (e: PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    window.removeEventListener('pointermove', ds.onMove);
    window.removeEventListener('pointerup', ds.onUp);
    window.removeEventListener('pointercancel', ds.onCancel);
    dragRef.current = null;
    setLineTagSnapGuides([]);
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
    setLineTagSnapGuides([]);
    ds.history.rollback();
  };

  return { lineTagSnapGuides, onStartDrag };
}
