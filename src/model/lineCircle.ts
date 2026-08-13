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
 * The quarter-unit GRID a dragged radius lands on lives at the two gesture
 * sites (`useLineCircleDrag`, `LineCirclePlacingPreview`) — a pointer distance
 * wants a grid, a typed diameter does not.
 */
export const canonicalLineCircleRadius = (r: number): number =>
  clampField(r, LINE_CIRCLE_RADIUS_MIN);

/**
 * The radius a POINTER gesture lands on: the quarter-unit grid, floored at the
 * minimum. Shared by the resize knob, the two-click placement drop and the
 * ghost ring that previews that drop, so preview and result can never disagree.
 * The popover's Diameter field does NOT come through here — a typed number is
 * kept as typed.
 */
export const snapDraggedLineCircleRadius = (r: number): number =>
  snapToStep(r, LINE_WIDTH_STEP, LINE_CIRCLE_RADIUS_MIN);
