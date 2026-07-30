import { describe, expect, it } from 'vitest';
import { makeLine, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import { snapDraggedStation } from './snap';
import { stopPosWorld } from './interlining';
import { STOP_SIZE } from './orientation';
import type { Line, LineId, Station, StationId } from '../model/types';

// A ring station's cells resolve through the RING frame, so its outer-lane dot
// does not sit where the octant frame would put it — up to 5.46 world units
// away. A snapper that aims at the octant position lands the dragged station
// that far off the axis it just promised to align with, and the octolinear
// router then can't express the segment at all: it degrades to a chord and
// flags the routing warning, for a pair the user explicitly snapped.
describe('snapping against a ring station aims at the dot that paints', () => {
  const CIRCLE = makeLineCircle({
    id: 'c1',
    x: -58.66520372400679,
    y: -21.922664231660345,
    radius: 118,
  });

  // To Kwa Wan's pose from the live map: bound, seated at rotation 7, carrying
  // a second line one lane OUT (col 1) — the lane whose position the ring frame
  // moves. Its tangent quantizes 4.4° off the octant, so the octant reading of
  // that lane misses by ~1.07 units.
  const ring: Station = makeStation({
    id: 'ring',
    x: 18.164652223154633,
    y: -111.4836671019857,
    rotation: 7,
    circleId: 'c1',
    stops: [makeStop('l0', { viaCircle: true }), makeStop('l1', { col: 1, viaCircle: true })],
  });

  const lines: Record<LineId, Line> = {
    l0: makeLine({ id: 'l0', stations: ['ring'] }),
    l1: makeLine({ id: 'l1', stations: ['ring', 'free'], edges: ['free|ring'] }),
  };

  it('lands the dragged stop EXACTLY on the axis through the ring stop', () => {
    // A free station carrying l1, dragged to roughly the 45° diagonal running
    // out of the ring stop — close enough to engage the snap, deliberately not
    // already on it.
    const free: Station = makeStation({
      id: 'free',
      x: 150.79,
      y: 1.34,
      rotation: 7,
      stops: [makeStop('l1')],
    });
    const stations: Record<StationId, Station> = { ring, free };
    const lineCircles = { c1: CIRCLE };

    const snapped = snapDraggedStation({
      draggedId: 'free',
      proposedX: free.x,
      proposedY: free.y,
      draggedRotation: free.rotation,
      draggedStops: free.stops,
      stations,
      lines,
      lineCircles,
      tolerance: 10,
    });
    expect(snapped.guides.length).toBeGreaterThan(0);

    const a = stopPosWorld(ring.stops[1], ring, lineCircles);
    const b = stopPosWorld(free.stops[0], { ...free, x: snapped.x, y: snapped.y }, lineCircles);
    // The promise of a diagonal snap: the two runs are equal. Not "within half
    // a unit" — equal, or the router has no octolinear route to draw.
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y), 9);
  });

  it('still aims true for the lane sitting ON the ring', () => {
    // Lane 0 has no radial offset, so octant and ring frames agree — this
    // passes either way and exists to keep the fix from being written as
    // "shift everything" rather than "resolve through the frame".
    const a = stopPosWorld(ring.stops[0], ring, { c1: CIRCLE });
    expect(Math.hypot(a.x - CIRCLE.x, a.y - CIRCLE.y)).toBeCloseTo(CIRCLE.radius, 9);
    const outer = stopPosWorld(ring.stops[1], ring, { c1: CIRCLE });
    expect(Math.hypot(outer.x - CIRCLE.x, outer.y - CIRCLE.y)).toBeCloseTo(
      CIRCLE.radius + STOP_SIZE,
      9,
    );
  });
});
