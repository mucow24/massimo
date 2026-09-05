import { STOP_SIZE } from '../geometry/orientation';
import { clampField, snapToStep } from '../util/grid';
import { LINE_WIDTH_STEP } from './lineWidth';

// A line circle's radius, world units. The floor is one stop-marker width — a
// circle tighter than a single station can't hold one meaningfully. New
// circles spawn at five stops of radius (the JFK-AirTrain proportion against
// default 14-wide lines).
export const LINE_CIRCLE_RADIUS_MIN = STOP_SIZE;
export const LINE_CIRCLE_RADIUS_DEFAULT = 5 * STOP_SIZE;

/**
 * The canonical STORED form of a line-circle radius: clamp to ≥
 * LINE_CIRCLE_RADIUS_MIN, keeping whatever radius it is handed. Unlike the
 * collapse-at-default line fields this is a REQUIRED field of the entity (like
 * Polygon.strokeWidth), so there is no undefined form. Shared by the
 * `setLineCircleRadius` transform and the file-import sanitizer so the two can
 * never drift. Callers own the finiteness guard (a transform ignores non-finite
 * input; the sanitizer drops the circle).
 *
 * This function does NOT quantise. The quarter-unit grid a dragged radius
 * lands on is `snapDraggedLineCircleRadius` below, applied at the gesture
 * sites — a pointer distance wants a grid, a typed diameter does not, and
 * keeping the clamp separate is what lets the popover's Diameter field hold an
 * off-grid number.
 */
export const canonicalLineCircleRadius = (r: number): number =>
  clampField(r, LINE_CIRCLE_RADIUS_MIN);

/**
 * The radius a POINTER gesture lands on: the quarter-unit grid, floored at the
 * minimum. Shared by the resize knob (`useLineCircleDrag`), the two-click
 * placement drop (`usePlacementDispatch`) and the ghost ring that previews that
 * drop (`LineCirclePlacingPreview`), so preview and result can never disagree.
 *
 * Two ways past it, both deliberate: the popover's Diameter field never comes
 * through here (a typed number is kept as typed), and **Shift declines the
 * grid** mid-drag exactly as it declines the point snapper on a move, storing
 * the raw pointer distance.
 */
export const snapDraggedLineCircleRadius = (r: number): number =>
  snapToStep(r, LINE_WIDTH_STEP, LINE_CIRCLE_RADIUS_MIN);

/**
 * The stations a set of line circles carries: every station BOUND to one of
 * them — selected or not, locked or not, since `moveLineCircle` takes its
 * passengers along either way.
 *
 * The one owner of that partition. Three gestures move rings, and each has to
 * keep its passengers OUT of its own station loop for the same reason:
 * `moveStation` RESEATS a bound station on its ring rather than translating
 * it, so a second write would slide the passenger round a rim that has already
 * moved and the group would visibly come apart. The three read this: the arrow
 * nudge (App.tsx, via selectionOps' `stationsCarriedByCircles`), the drag tow
 * (groupDrag's `carriedStations`) and the orbit (`rotateItemsAround`'s
 * `carriedByCircle`). Each used to spell the walk out inline, agreeing by
 * inspection only.
 *
 * Takes any iterable of ids because the drag half already holds its moving
 * rings as a Set.
 */
export function stationsOnCircles(
  stations: Record<string, { circleId?: string }>,
  circleIds: Iterable<string>,
): Set<string> {
  const carried = new Set<string>();
  const moving = new Set(circleIds);
  if (moving.size === 0) return carried;
  for (const id of Object.keys(stations)) {
    const cid = stations[id].circleId;
    if (cid !== undefined && moving.has(cid)) carried.add(id);
  }
  return carried;
}
