import { describe, expect, it } from 'vitest';
import { makeDoc, makeLine, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import {
  addLineCircle,
  addStationToLine,
  bindStationToCircle,
  deleteLineCircle,
  moveLineCircle,
  moveStation,
  rotateStop,
  setLineCircleLocked,
  setLineCircleRadius,
  setStopViaCircle,
  spawnStopCellAt,
  unbindStationFromCircle,
} from './transforms';
import { LINE_CIRCLE_RADIUS_DEFAULT, LINE_CIRCLE_RADIUS_MIN } from './lineCircle';
import type { MapDoc } from './types';

const CIRCLE = makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 });

// A station bound to c1, sitting on its east point (angle 0).
function boundDoc(): MapDoc {
  return makeDoc({
    stations: [
      // On c1's east point (angle 0), at the tangent octant there (rotation 0).
      makeStation({
        id: 's1',
        x: 170,
        y: 100,
        rotation: 0,
        circleId: 'c1',
        stops: [makeStop('l1', { viaCircle: true })],
      }),
      makeStation({ id: 'free', x: 300, y: 300 }),
    ],
    lineCircles: [CIRCLE],
  });
}

describe('addLineCircle', () => {
  it('adds a circle with a canonicalized radius', () => {
    const doc = addLineCircle(makeDoc({}), 'c1', 10, 20, 33.13);
    expect(doc.lineCircles.c1).toEqual({ id: 'c1', x: 10, y: 20, radius: 33.25 });
  });

  it('defaults the radius and floors it at the minimum', () => {
    const doc = addLineCircle(makeDoc({}), 'c1', 0, 0);
    expect(doc.lineCircles.c1.radius).toBe(LINE_CIRCLE_RADIUS_DEFAULT);
    const tiny = addLineCircle(makeDoc({}), 'c2', 0, 0, 1);
    expect(tiny.lineCircles.c2.radius).toBe(LINE_CIRCLE_RADIUS_MIN);
  });
});

describe('moveLineCircle', () => {
  it('translates the circle and its bound stations rigidly', () => {
    const doc = boundDoc();
    const out = moveLineCircle(doc, 'c1', 130, 90);
    expect(out.lineCircles.c1).toMatchObject({ x: 130, y: 90 });
    // s1 rode along (+30, -10); rotation untouched (tangent angle unchanged).
    expect(out.stations.s1).toMatchObject({ x: 200, y: 90, rotation: 0 });
    // The free station did not move.
    expect(out.stations.free).toBe(doc.stations.free);
  });

  it('returns the same doc when the center is unchanged', () => {
    const doc = boundDoc();
    expect(moveLineCircle(doc, 'c1', 100, 100)).toBe(doc);
  });
});

describe('setLineCircleRadius', () => {
  it('reprojects bound stations radially, preserving their angle', () => {
    const doc = boundDoc();
    const out = setLineCircleRadius(doc, 'c1', 140);
    expect(out.lineCircles.c1.radius).toBe(140);
    // s1 was at angle 0 (east); it stays east at the new radius.
    expect(out.stations.s1.x).toBeCloseTo(240, 9);
    expect(out.stations.s1.y).toBeCloseTo(100, 9);
    expect(out.stations.free).toBe(doc.stations.free);
  });

  it('no-ops on the same radius and ignores non-finite input', () => {
    const doc = boundDoc();
    expect(setLineCircleRadius(doc, 'c1', 70)).toBe(doc);
    expect(setLineCircleRadius(doc, 'c1', NaN)).toBe(doc);
  });
});

describe('setLineCircleLocked', () => {
  it('stores true and drops the field on unlock', () => {
    const doc = boundDoc();
    const locked = setLineCircleLocked(doc, 'c1', true);
    expect(locked.lineCircles.c1.locked).toBe(true);
    const unlocked = setLineCircleLocked(locked, 'c1', false);
    expect('locked' in unlocked.lineCircles.c1).toBe(false);
    expect(setLineCircleLocked(doc, 'c1', false)).toBe(doc);
  });
});

describe('deleteLineCircle', () => {
  it('strips bindings and via flags but leaves stations where they stand', () => {
    const doc = boundDoc();
    const out = deleteLineCircle(doc, 'c1');
    expect(out.lineCircles.c1).toBeUndefined();
    const s1 = out.stations.s1;
    expect(s1.circleId).toBeUndefined();
    expect('circleId' in s1).toBe(false);
    expect(s1).toMatchObject({ x: 170, y: 100, rotation: 0 });
    expect('viaCircle' in s1.stops[0]).toBe(false);
    expect(out.stations.free).toBe(doc.stations.free);
  });

  it('no-ops on an unknown id', () => {
    const doc = boundDoc();
    expect(deleteLineCircle(doc, 'nope')).toBe(doc);
  });
});

describe('bindStationToCircle', () => {
  it('projects the station onto the circumference and rotates it to the tangent octant', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', x: 300, y: 100 })],
      lineCircles: [CIRCLE],
    });
    const out = bindStationToCircle(doc, 's1', 'c1');
    const s1 = out.stations.s1;
    expect(s1.circleId).toBe('c1');
    // Due east of the center: projected to the east point.
    expect(s1.x).toBeCloseTo(170, 9);
    expect(s1.y).toBeCloseTo(100, 9);
    // Tangent at angle 0 is vertical (local +y along ±(0,1)). Rotation 0 keeps
    // the default label (rotation 0) upright, so no flip: rotation 0.
    expect(s1.rotation).toBe(0);
  });

  it('flips 180° when the tangent octant would render the label upside down', () => {
    // West of the center (angle π): tangent axis is vertical again but the
    // raw tangent (0,-1) maps to rotation 4, which turns a rotation-0 label
    // upside down — expect the flipped, axis-equivalent rotation 0.
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', x: 0, y: 100 })],
      lineCircles: [CIRCLE],
    });
    const out = bindStationToCircle(doc, 's1', 'c1');
    expect(out.stations.s1.x).toBeCloseTo(30, 9);
    expect(out.stations.s1.y).toBeCloseTo(100, 9);
    expect(out.stations.s1.rotation).toBe(0);
  });

  it('no-ops on a missing circle or station, and when already bound in place', () => {
    const doc = boundDoc();
    expect(bindStationToCircle(doc, 's1', 'nope')).toBe(doc);
    expect(bindStationToCircle(doc, 'nope', 'c1')).toBe(doc);
    // s1 is already bound, on the circle, at a tangent rotation.
    expect(bindStationToCircle(doc, 's1', 'c1')).toBe(doc);
  });
});

describe('unbindStationFromCircle', () => {
  it('drops the binding and every viaCircle flag, keeping position', () => {
    const doc = boundDoc();
    const out = unbindStationFromCircle(doc, 's1');
    const s1 = out.stations.s1;
    expect('circleId' in s1).toBe(false);
    expect('viaCircle' in s1.stops[0]).toBe(false);
    expect(s1).toMatchObject({ x: 170, y: 100 });
    expect(unbindStationFromCircle(out, 's1')).toBe(out);
  });
});

describe('setStopViaCircle', () => {
  it('sets and clears the flag, dropping the key when cleared', () => {
    const doc = boundDoc();
    const cleared = setStopViaCircle(doc, 's1', 'l1', false);
    expect('viaCircle' in cleared.stations.s1.stops[0]).toBe(false);
    const set = setStopViaCircle(cleared, 's1', 'l1', true);
    expect(set.stations.s1.stops[0].viaCircle).toBe(true);
    expect(setStopViaCircle(set, 's1', 'l1', true)).toBe(set);
    expect(setStopViaCircle(cleared, 's1', 'l1', false)).toBe(cleared);
  });

  it('refuses to set the flag on an unbound station', () => {
    const doc = unbindStationFromCircle(boundDoc(), 's1');
    expect(setStopViaCircle(doc, 's1', 'l1', true)).toBe(doc);
  });

  it('is cleared by an explicit orientation edit (the opt-out gesture)', () => {
    const doc = boundDoc();
    const out = rotateStop(doc, 's1', 'l1');
    expect(out.stations.s1.stops[0].orientation).toBe('auto-ne-sw');
    expect('viaCircle' in out.stations.s1.stops[0]).toBe(false);
  });
});

describe('stop spawn + line add on a bound station', () => {
  it('a stop spawned on a bound station defaults to riding the circle', () => {
    const doc = boundDoc();
    const cell = spawnStopCellAt(doc.stations.s1, 'l2', {});
    expect(cell.viaCircle).toBe(true);
    const free = spawnStopCellAt(doc.stations.free, 'l2', {});
    expect('viaCircle' in free).toBe(false);
  });

  it('addStationToLine keeps a bound station at its tangent rotation', () => {
    // s1 sits at the circle's east point (tangent rotation 0); the line's only
    // other member is far north-east, whose travel direction would autoOrient
    // an unbound station to a diagonal. Bound stations skip that — the circle
    // owns their rotation.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 170, y: 100, rotation: 0, circleId: 'c1' }),
        makeStation({ id: 'n1', x: 400, y: -200, stops: [makeStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['n1'] })],
      lineCircles: [CIRCLE],
    });
    const out = addStationToLine(doc, 'l1', 's1');
    expect(out.stations.s1.rotation).toBe(0);
    expect(out.stations.s1.stops[0].viaCircle).toBe(true);
  });
});

describe('bindStationToCircle flags existing stops', () => {
  it('sets viaCircle on every stop (the always-arc default; flip to opt out)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 300,
          y: 100,
          stops: [makeStop('l1'), makeStop('l2', { col: 1 })],
        }),
      ],
      lineCircles: [CIRCLE],
    });
    const out = bindStationToCircle(doc, 's1', 'c1');
    expect(out.stations.s1.stops.every((c) => c.viaCircle === true)).toBe(true);
  });
});

describe('moveStation on a bound station', () => {
  it('projects the target onto the circle and keeps the tangent octant fresh', () => {
    const doc = boundDoc();
    // Aim due south of the center: the station slides to the circle's south
    // point (100, 170). Tangent there is horizontal — rotation 2 (or its
    // flip 6); label rotation 0 at station rotation 2 reads sideways-up,
    // not upside down, so no flip.
    const out = moveStation(doc, 's1', 100, 400);
    expect(out.stations.s1.x).toBeCloseTo(100, 9);
    expect(out.stations.s1.y).toBeCloseTo(170, 9);
    expect(out.stations.s1.rotation).toBe(2);
  });

  it('moves an unbound station raw', () => {
    const doc = boundDoc();
    const out = moveStation(doc, 'free', 123, 456);
    expect(out.stations.free).toMatchObject({ x: 123, y: 456 });
  });
});
