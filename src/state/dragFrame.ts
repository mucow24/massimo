/**
 * The in-flight pipelined drag frame's REGION output: the exclusion holes the
 * worker computed for the doc-slice snapshot currently armed on the render
 * source. `null` at rest and for every non-pipelined gesture — MapCanvas then
 * computes holes synchronously as always.
 *
 * The pipeline sets this and the render-source overlay in the same synchronous
 * block, so React batches them into one render: the canvas can never paint
 * holes from one frame over strokes from another.
 */
import { create } from 'zustand';
import type { LineId } from '../model/types';
import type { Ring } from '../geometry/clip';

interface DragFrameState {
  holes: Map<LineId, Ring[]> | null;
}

export const useDragFrame = create<DragFrameState>(() => ({ holes: null }));

export function setDragFrameHoles(holes: Map<LineId, Ring[]> | null): void {
  useDragFrame.setState({ holes });
}
