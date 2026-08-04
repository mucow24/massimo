import { useCallback, useState } from 'react';
import type { SnapGuide } from '../../geometry/snap';
import { snapGuidesEqual } from '../../geometry/snap';
import { routeSnapGuides, type SnapGuideSource } from '../../worker/regionPipeline';

/**
 * Drop-in replacement for a drag hook's `useState<SnapGuide[]>`: same
 * [guides, set] shape, but every set is offered to the region pipeline first.
 * While a pipelined frame is armed the guides become frame cargo — surfacing
 * only when the frame they were computed with renders — and the hook's own
 * state is left untouched, so guide churn stops re-rendering the canvas
 * mid-pipelined-drag. At rest the setter behaves exactly like before,
 * including the keep-the-previous-array equality bail.
 *
 * One consequence the hooks own: their gesture-END clears must run AFTER the
 * gesture's history exit (finishDrag / rollback), not before — the exit is
 * what drains the pipeline, and a clear issued while still armed would be
 * routed away, stranding the pre-arm guides in hook state.
 */
export function useRoutedSnapGuides(
  source: SnapGuideSource,
): [SnapGuide[], (next: SnapGuide[]) => void] {
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const set = useCallback(
    (next: SnapGuide[]) => {
      if (routeSnapGuides(source, next)) return;
      setGuides((prev) => (snapGuidesEqual(prev, next) ? prev : next));
    },
    [source],
  );
  return [guides, set];
}
