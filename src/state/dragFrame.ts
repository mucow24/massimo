/**
 * The landed pipelined drag frame: everything the worker's answer contributes
 * to one coherent paint. `null` at rest and for every non-pipelined gesture —
 * MapCanvas then computes holes synchronously and renders guides straight
 * from the drag hooks, as always.
 *
 * Guides are frame CARGO, not live state: a guide halo drawn from input N
 * around a dot still painted at frame N-1 visibly tears off it, so the
 * pipeline captures the guides published with input N and releases them only
 * when frame N's snapshot renders (the plan's "guides ride the frame").
 *
 * The pipeline sets this and the render-source overlay in the same
 * synchronous block, so React batches them into one render: holes, guides
 * and strokes can never paint from different frames.
 */
import { create } from 'zustand';
import type { LineId } from '../model/types';
import type { Ring } from '../geometry/clip';
import type { SnapGuide } from '../geometry/snap';

export interface DragFrame {
  // `null` when the frame carries guides ALONE: the pipeline fell back
  // mid-gesture, so holes are the canvas's synchronous business again, but the
  // guides it had already taken off the hooks still have to be painted until
  // the hooks resume publishing their own.
  holes: Map<LineId, Ring[]> | null;
  guides: SnapGuide[];
}

export const useDragFrame = create<{ frame: DragFrame | null }>(() => ({ frame: null }));

export function setDragFrame(frame: DragFrame | null): void {
  useDragFrame.setState({ frame });
}
