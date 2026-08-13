import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import {
  snapToleranceAt,
  type GuideTarget,
  type SnapConstraint,
  type SnapModes,
} from '../../geometry/snap';
import { snapPolygonPoint, type PolygonSnapResult } from '../../geometry/polygonSnap';
import type { Vec2 } from '../../geometry/vec';

/** What a caller varies per snap: its target pools and any single-DOF lock. */
export interface DragSnapOptions {
  /** "Snap to all" pool, snapshotted at pointer-down by the caller. */
  allTargets: Vec2[];
  /** "Snap to line" pool — only the polygon vertex drag has one. */
  lineTargets?: Vec2[];
  /** Alignment-guide pool (always-on), snapshotted at pointer-down like the
   *  others — see liveGuideTargets. Absent means no guides in play. */
  guideTargets?: readonly GuideTarget[];
  /** Single-DOF consumers (edge resizes, guide drags); see {@link snapPolygonPoint}. */
  constrain?: SnapConstraint;
}

export interface DragSnapApi {
  /** The live snap toggles, for the callers that also drive the station engine. */
  modes: SnapModes;
  /** The live grid size in world units. */
  gridInterval: number;
  snapPoint: (proposed: Vec2, opts: DragSnapOptions) => PolygonSnapResult;
}

/**
 * The point snapper bound to the live snap prefs, the active grid size and the
 * camera zoom — the three inputs every drag site was reading and re-threading
 * for itself.
 *
 * The tolerance is the reason it exists: a caller that forgot to convert the
 * world-unit constant for the camera zoom would snap from twice as far out at
 * 2× (see Snapping in ARCHITECTURE.md). The conversion itself belongs to
 * `snapToleranceAt`, which the station engine's sites share; this hook's job is
 * to bind it to the live prefs and grid so the point-snapper callers pass
 * nothing but their own pools.
 */
export function useDragSnap(zoom: number): DragSnapApi {
  const modes = useSnapPrefs((s) => s.modes);
  const gridInterval = useViewportStore((s) => s.gridSize);
  return {
    modes,
    gridInterval,
    snapPoint: (proposed, opts) =>
      snapPolygonPoint({
        proposed,
        lineTargets: opts.lineTargets ?? [],
        allTargets: opts.allTargets,
        guideTargets: opts.guideTargets,
        modes,
        tolerance: snapToleranceAt(zoom),
        gridInterval,
        constrain: opts.constrain,
      }),
  };
}
