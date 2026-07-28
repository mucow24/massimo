import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { SNAP_PERP_TOLERANCE, type SnapModes } from '../../geometry/snap';
import { snapPolygonPoint, type PolygonSnapResult } from '../../geometry/polygonSnap';
import type { Vec2 } from '../../geometry/vec';

/** What a caller varies per snap: its target pools and any single-DOF lock. */
export interface DragSnapOptions {
  /** "Snap to all" pool, snapshotted at pointer-down by the caller. */
  allTargets: Vec2[];
  /** "Snap to line" pool — only the polygon vertex drag has one. */
  lineTargets?: Vec2[];
  /** Single-DOF consumers (edge resizes); see {@link snapPolygonPoint}. */
  constrain?: 'x' | 'y';
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
 * The reason to have it is the TOLERANCE. `SNAP_PERP_TOLERANCE` is the value at
 * zoom 1 and every path must divide it by the zoom so the engage radius is a
 * constant number of SCREEN pixels (see Snapping in ARCHITECTURE.md) — a
 * must-agree rule that was restated at every call site, where a site could
 * quietly pass the world-unit constant and snap from twice as far out when
 * zoomed in. Here it is one expression.
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
        modes,
        // Constant screen-pixel engage radius, at every zoom.
        tolerance: SNAP_PERP_TOLERANCE / zoom,
        gridInterval,
        constrain: opts.constrain,
      }),
  };
}
