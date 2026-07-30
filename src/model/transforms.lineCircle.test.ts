import { describe, expect, it } from 'vitest';
import { makeDoc, makeLine, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import {
  addLineCircle,
  addStationToLine,
  bindStationToCircle,
  deleteLine,
  deleteLineCircle,
  moveLineCircle,
  moveStation,
  removeStationFromLine,
  rotateStop,
  setLineCircleLocked,
  setLineCircleRadius,
  setStopViaCircle,
  spawnStopCellAt,
  stopCanRideCircle,
  unbindStationFromCircle,
} from './transforms';
import { LINE_CIRCLE_RADIUS_DEFAULT, LINE_CIRCLE_RADIUS_MIN } from './lineCircle';
import type { MapDoc } from './types';
import { stopPosWorld } from '../geometry/interlining';
import { STOP_SIZE } from '../geometry/orientation';

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
    // Leaving the Circle state lands on the first axis of the cycle.
    expect(out.stations.s1.stops[0].orientation).toBe('auto-vertical');
    expect('viaCircle' in out.stations.s1.stops[0]).toBe(false);
  });
});

// Two bound stations joined by l1 — the stop at s1 CAN form a circular
// connection, so its direction cycle includes the Circle state.
function ringLineDoc(): MapDoc {
  return makeDoc({
    stations: [
      makeStation({
        id: 's1',
        x: 170,
        y: 100,
        circleId: 'c1',
        stops: [makeStop('l1', { viaCircle: true })],
      }),
      makeStation({
        id: 's2',
        x: 100,
        y: 170,
        rotation: 2,
        circleId: 'c1',
        stops: [makeStop('l1', { viaCircle: true })],
      }),
    ],
    lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
    lineCircles: [CIRCLE],
  });
}

describe('stopCanRideCircle', () => {
  it('true only when bound AND a line-neighbor sits on the same circle', () => {
    const doc = ringLineDoc();
    expect(stopCanRideCircle(doc, 's1', 'l1')).toBe(true);
    // Unbind the NEIGHBOR: s1 stays bound but no partner remains.
    const half = unbindStationFromCircle(doc, 's2');
    expect(stopCanRideCircle(half, 's1', 'l1')).toBe(false);
    // Unbound station: never.
    expect(stopCanRideCircle(unbindStationFromCircle(doc, 's1'), 's1', 'l1')).toBe(false);
    // No edges on the line: nothing to connect circularly.
    const edgeless = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 170, y: 100, circleId: 'c1', stops: [makeStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['s1'], edges: [] })],
      lineCircles: [CIRCLE],
    });
    expect(stopCanRideCircle(edgeless, 's1', 'l1')).toBe(false);
  });

  it('binding is station-level, so two opted-out stops cannot deadlock each other', () => {
    // Both stops flipped to normal routing: each can still cycle back to
    // Circle, because eligibility reads the NEIGHBOR STATION's binding, not
    // its stop's flag.
    let doc = ringLineDoc();
    doc = setStopViaCircle(doc, 's1', 'l1', false);
    doc = setStopViaCircle(doc, 's2', 'l1', false);
    expect(stopCanRideCircle(doc, 's1', 'l1')).toBe(true);
    expect(stopCanRideCircle(doc, 's2', 'l1')).toBe(true);
  });
});

describe('rotateStop — the five-state direction cycle on circle stops', () => {
  it('cycles Circle → the four axes → back to Circle', () => {
    let doc = ringLineDoc();
    const stop = () => doc.stations.s1.stops[0];
    expect(stop().viaCircle).toBe(true);
    doc = rotateStop(doc, 's1', 'l1'); // Circle → V
    expect('viaCircle' in stop()).toBe(false);
    expect(stop().orientation).toBe('auto-vertical');
    doc = rotateStop(doc, 's1', 'l1'); // V → NE
    expect(stop().orientation).toBe('auto-ne-sw');
    doc = rotateStop(doc, 's1', 'l1'); // NE → H
    expect(stop().orientation).toBe('auto-horizontal');
    doc = rotateStop(doc, 's1', 'l1'); // H → NW
    expect(stop().orientation).toBe('auto-nw-se');
    doc = rotateStop(doc, 's1', 'l1'); // NW → Circle (back where we started)
    expect(stop().viaCircle).toBe(true);
    expect(stop().orientation).toBe('auto-vertical');
  });

  it('keeps the plain four-axis wrap when the stop cannot ride the circle', () => {
    let doc = unbindStationFromCircle(ringLineDoc(), 's2');
    doc = rotateStop(doc, 's1', 'l1'); // Circle state exits to V (flag cleared)
    doc = rotateStop(doc, 's1', 'l1'); // V → NE
    doc = rotateStop(doc, 's1', 'l1'); // NE → H
    doc = rotateStop(doc, 's1', 'l1'); // H → NW
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-nw-se');
    doc = rotateStop(doc, 's1', 'l1'); // NW wraps straight to V — no Circle
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-vertical');
    expect('viaCircle' in doc.stations.s1.stops[0]).toBe(false);
  });
});

describe('stop spawn + line add on a bound station', () => {
  it('a stop spawned on a bound station defaults to riding the circle', () => {
    const doc = boundDoc();
    const cell = spawnStopCellAt(doc.stations.s1, 'l2', {}, doc.lineCircles);
    expect(cell.viaCircle).toBe(true);
    const free = spawnStopCellAt(doc.stations.free, 'l2', {});
    expect('viaCircle' in free).toBe(false);
  });

  it('stacks new stops RADIALLY OUTWARD on a bound station, at every angle', () => {
    // East point (angle 0, rotation 0): radial-out is world +x = local +x.
    const doc = boundDoc();
    const east = spawnStopCellAt(doc.stations.s1, 'l2', {}, doc.lineCircles);
    expect(east).toMatchObject({ row: 0, col: 1 });
    // West point with the label-flip rotation 0: radial-out is world −x =
    // local −x — the naive "east of rightmost" spawn would land radially IN.
    const west = makeStation({
      id: 'w',
      x: 30,
      y: 100,
      rotation: 0,
      circleId: 'c1',
      stops: [makeStop('l1', { viaCircle: true })],
    });
    const wCell = spawnStopCellAt(west, 'l2', {}, { c1: CIRCLE });
    expect(wCell).toMatchObject({ row: 0, col: -1 });
    // South point at rotation 2: radial-out is world +y = local +x again.
    const south = makeStation({
      id: 's',
      x: 100,
      y: 170,
      rotation: 2,
      circleId: 'c1',
      stops: [makeStop('l1', { viaCircle: true })],
    });
    const sCell = spawnStopCellAt(south, 'l2', {}, { c1: CIRCLE });
    expect(sCell).toMatchObject({ row: 0, col: 1 });
    // A third line continues outward past the outermost stop.
    const eastTwo = { ...doc.stations.s1, stops: [...doc.stations.s1.stops, east] };
    const third = spawnStopCellAt(eastTwo, 'l3', {}, doc.lineCircles);
    expect(third).toMatchObject({ row: 0, col: 2 });
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

describe('re-homing a bound station after a stop removal', () => {
  // A bound interchange whose ring line (l1) sits at the origin cell and
  // whose second line (l2) is packed one cell radially out, label beside.
  function interchangeDoc(): MapDoc {
    return makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 170,
          y: 100,
          rotation: 0,
          circleId: 'c1',
          stops: [makeStop('l1', { viaCircle: true }), makeStop('l2', { col: 1, viaCircle: true })],
          label: { row: 0, col: 2, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
        }),
        makeStation({ id: 'n1', x: 400, y: 100, stops: [makeStop('l1'), makeStop('l2')] }),
      ],
      lines: [
        makeLine({ id: 'l1', stations: ['s1', 'n1'] }),
        makeLine({ id: 'l2', stations: ['s1', 'n1'] }),
      ],
      lineCircles: [CIRCLE],
    });
  }

  it('removing the origin stop slides the survivors back onto the ring (label rides)', () => {
    const doc = interchangeDoc();
    const idx = doc.lines.l1.stations.indexOf('s1');
    const out = removeStationFromLine(doc, 'l1', idx);
    const s1 = out.stations.s1;
    expect(s1.stops).toHaveLength(1);
    // The surviving l2 stop is HOME now — its dot sits on the circle again.
    expect(s1.stops[0]).toMatchObject({ lineId: 'l2', row: 0, col: 0 });
    // The label translated with the layout, keeping its relative spot.
    expect(s1.label).toMatchObject({ row: 0, col: 1 });
  });

  it('deleting a line re-homes its bound stations the same way', () => {
    const doc = interchangeDoc();
    const out = deleteLine(doc, 'l1');
    expect(out.stations.s1.stops[0]).toMatchObject({ lineId: 'l2', row: 0, col: 0 });
  });

  it('leaves unbound stations alone (manual repacking stays manual)', () => {
    const doc = interchangeDoc();
    const idx = doc.lines.l1.stations.indexOf('n1');
    const out = removeStationFromLine(doc, 'l1', idx);
    // n1's surviving stop keeps its cell — no silent reflow off the circle path.
    expect(out.stations.n1.stops[0]).toMatchObject({ lineId: 'l2', row: 0, col: 0 });
    const shifted = {
      ...doc,
      stations: {
        ...doc.stations,
        n1: { ...doc.stations.n1, stops: [doc.stations.n1.stops[0], makeStop('l2', { col: 3 })] },
      },
    };
    const idx2 = shifted.lines.l1.stations.indexOf('n1');
    const out2 = removeStationFromLine(shifted, 'l1', idx2);
    expect(out2.stations.n1.stops[0]).toMatchObject({ lineId: 'l2', col: 3 });
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

// `circleSeat` turns `rotation` a full 180° where the label would otherwise
// read upside-down. Cells are expressed in that frame, so without compensation
// the turn silently mirrors the layout through the anchor and every lane
// crosses to the other side of the rim.
describe('a re-seat keeps the layout on its side of the ring', () => {
  // Two lanes: l1 on the rim, l2 one lane out.
  function twoLaneRing(): MapDoc {
    return makeDoc({
      stations: [
        makeStation({
          id: 's',
          x: 170,
          y: 100,
          rotation: 0,
          circleId: 'c1',
          stops: [makeStop('l1', { viaCircle: true }), makeStop('l2', { col: 1, viaCircle: true })],
        }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['s'] }), makeLine({ id: 'l2', stations: ['s'] })],
      lineCircles: [CIRCLE],
    });
  }

  const laneRadius = (doc: MapDoc, lineId: string): number => {
    const st = doc.stations.s;
    const p = stopPosWorld(st.stops.find((c) => c.lineId === lineId)!, st, doc.lineCircles);
    return Math.hypot(p.x - CIRCLE.x, p.y - CIRCLE.y);
  };

  it('keeps the outer lane OUTSIDE at every angle around the circle', () => {
    const doc = twoLaneRing();
    const inside: number[] = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const moved = moveStation(
        doc,
        's',
        CIRCLE.x + CIRCLE.radius * Math.cos(rad),
        CIRCLE.y + CIRCLE.radius * Math.sin(rad),
      );
      expect(laneRadius(moved, 'l1')).toBeCloseTo(CIRCLE.radius, 9);
      if (laneRadius(moved, 'l2') < CIRCLE.radius) inside.push(deg);
    }
    expect(inside).toEqual([]);
  });

  it('preserves stop world positions across the uprightness flip', () => {
    // 150° is inside the flipped band: the seat there turns rotation by 180°
    // relative to the east seat, so this is the compensation under test.
    const doc = twoLaneRing();
    const rad = (150 * Math.PI) / 180;
    const moved = moveStation(
      doc,
      's',
      CIRCLE.x + CIRCLE.radius * Math.cos(rad),
      CIRCLE.y + CIRCLE.radius * Math.sin(rad),
    );
    // The flip really happened — otherwise this test proves nothing.
    expect((moved.stations.s.rotation - doc.stations.s.rotation + 8) % 8).not.toBe(0);
    // Cells negated, so the lane is still one step radially OUT.
    expect(laneRadius(moved, 'l2')).toBeCloseTo(CIRCLE.radius + STOP_SIZE, 9);
    // The name still flips right-side-up: label.rotation is untouched, so the
    // 180° lands on the label's WORLD angle, which is what the flip is for.
    expect(moved.stations.s.label.rotation).toBe(doc.stations.s.label.rotation);
  });
});
