import { STOP_SIZE } from '../geometry/orientation';
import { roundClamp } from '../util/grid';
import { LINE_WIDTH_STEP } from './lineWidth';

// A line circle's radius, world units. The floor is one stop-marker width — a
// circle tighter than a single station can't hold one meaningfully. New
// circles spawn at five stops of radius (the JFK-AirTrain proportion against
// default 14-wide lines).
export const LINE_CIRCLE_RADIUS_MIN = STOP_SIZE;
export const LINE_CIRCLE_RADIUS_DEFAULT = 5 * STOP_SIZE;

/**
 * The canonical STORED form of a line-circle radius: round to the quarter-unit
 * grid and clamp to ≥ LINE_CIRCLE_RADIUS_MIN. Unlike the collapse-at-default
 * line fields this is a REQUIRED field of the entity (like Polygon.strokeWidth),
 * so there is no undefined form. Shared by the `setLineCircleRadius` transform
 * and the file-import sanitizer so the two can never drift. Callers own the
 * finiteness guard (a transform ignores non-finite input; the sanitizer drops
 * the circle).
 */
export const canonicalLineCircleRadius = (r: number): number =>
  roundClamp(r, LINE_WIDTH_STEP, LINE_CIRCLE_RADIUS_MIN);
