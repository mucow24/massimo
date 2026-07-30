import { beforeEach, describe, expect, it } from 'vitest';
import { makeDoc, makeLineCircle, makeLine, makeStation, makeStop } from '../test/fixtures';
import {
  __resetSpecReuse,
  buildBandGeometry,
  buildStopMarkers,
  stopPosWorld,
  type SegmentBandSpec,
} from './interlining';
import { STOP_SIZE } from './orientation';
import { offsetPathLength, sampleOffsetPath } from './lineTagGeometry';
import * as T from '../model/transforms';
import type { MapDoc, Rotation, Station } from '../model/types';

const R = 70;
const CX = 100;
const CY = 100;

beforeEach(() => __resetSpecReuse());

// A single-stop station bound to c1, sitting on the circle at `theta`,
// rotated to the tangent octant nearest that angle.
function ringStation(
  id: string,
  theta: number,
  opts: { viaCircle?: boolean; rotation?: Rotation; extraStop?: boolean } = {},
): Station {
  return makeStation({
    id,
    x: CX + R * Math.cos(theta),
    y: CY + R * Math.sin(theta),
    rotation: opts.rotation ?? 0,
    circleId: 'c1',
    stops: [
      makeStop('l1', { viaCircle: opts.viaCircle ?? true }),
      ...(opts.extraStop ? [makeStop('l2', { col: 1, viaCircle: opts.viaCircle ?? true })] : []),
    ],
  });
}

function ringDoc(overrides?: { stations?: Station[] }): MapDoc {
  return makeDoc({
    stations: overrides?.stations ?? [
      ringStation('s1', 0), // east point (170, 100)
      ringStation('s2', Math.PI / 2, { rotation: 2 }), // south point (100, 170)
    ],
    lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
    lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
  });
}

function distFromCenter(p: { x: number; y: number }): number {
  return Math.hypot(p.x - CX, p.y - CY);
}

function bandArcSamples(band: SegmentBandSpec, offset: number, n = 9): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(distFromCenter(sampleOffsetPath(band.centerline, band.radius, offset, i / n).p));
  }
  return out;
}

describe('viaCircle edges render as circular arcs', () => {
  it('routes the edge as the shorter arc of the bound circle', () => {
    const doc = ringDoc();
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands).toHaveLength(1);
    const band = bands[0];
    // Every sampled centerline point sits on the circle...
    for (const d of bandArcSamples(band, 0)) expect(d).toBeCloseTo(R, 3);
    // ...and the stripe length is the quarter-circle arc, not a detour.
    expect(offsetPathLength(band.centerline, band.radius, 0)).toBeCloseTo((R * Math.PI) / 2, 2);
    // Endpoints are the stop positions.
    const first = band.centerline[0];
    const last = band.centerline[band.centerline.length - 1];
    expect(first.x).toBeCloseTo(170, 6);
    expect(first.y).toBeCloseTo(100, 6);
    expect(last.x).toBeCloseTo(100, 6);
    expect(last.y).toBeCloseTo(170, 6);
    expect(band.warning).toBe(false);
    // The painted path is a real SVG arc, not a chord.
    expect(band.paths[0]).toContain('A ');
  });

  it('falls back to octolinear when either stop has not opted in', () => {
    const doc = ringDoc({
      stations: [ringStation('s1', 0), ringStation('s2', Math.PI / 2, { viaCircle: false })],
    });
    const withCircles = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    __resetSpecReuse();
    const without = buildBandGeometry(doc.stations, doc.lines, {});
    expect(withCircles).toHaveLength(1);
    expect(withCircles[0].paths).toEqual(without[0].paths);
  });

  it('falls back to octolinear when the stations are bound to different circles', () => {
    const doc = ringDoc();
    const s2 = { ...doc.stations.s2, circleId: 'c2' };
    const stations = { ...doc.stations, s2 };
    const lineCircles = {
      ...doc.lineCircles,
      c2: makeLineCircle({ id: 'c2', x: 400, y: 400, radius: R }),
    };
    const bands = buildBandGeometry(stations, doc.lines, lineCircles);
    __resetSpecReuse();
    const without = buildBandGeometry(stations, doc.lines, {});
    expect(bands[0].paths).toEqual(without[0].paths);
  });

  it('falls back to octolinear when the radial offsets disagree — and WARNS', () => {
    // s2's stop is pushed one cell radially outward (col 1 at rotation 2 =
    // world +y = radially out at the south point); s1's stays on the circle.
    // Both stops asked to ride (viaCircle), so the silent-degrade would be a
    // lie — the band flags the routing warning instead.
    const doc = ringDoc();
    const s2 = doc.stations.s2;
    const stations = {
      ...doc.stations,
      s2: { ...s2, stops: [{ ...s2.stops[0], col: 1 }] },
    };
    const bands = buildBandGeometry(stations, doc.lines, doc.lineCircles);
    __resetSpecReuse();
    const without = buildBandGeometry(stations, doc.lines, {});
    expect(bands[0].paths).toEqual(without[0].paths);
    expect(bands[0].warning).toBe(true);
    expect(without[0].warning).toBe(false);
  });

  it('does NOT warn when a stop deliberately opted out (one end unflagged)', () => {
    const doc = ringDoc({
      stations: [ringStation('s1', 0), ringStation('s2', Math.PI / 2, { viaCircle: false })],
    });
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands[0].warning).toBe(false);
  });

  it('interlines two packed lines as exactly concentric stripes', () => {
    const doc = makeDoc({
      stations: [
        ringStation('s1', 0, { extraStop: true }),
        ringStation('s2', Math.PI / 2, { rotation: 2, extraStop: true }),
      ],
      lines: [
        makeLine({ id: 'l1', stations: ['s1', 's2'] }),
        makeLine({ id: 'l2', stations: ['s1', 's2'] }),
      ],
      lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
    });
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands).toHaveLength(1);
    const band = bands[0];
    expect(band.lines.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(band.stripeOffsets).toEqual([-7, 7]);
    // Mean radius 77; stripes ride exactly concentric circles at 70 and 84.
    expect(band.radius).toBeCloseTo(77, 6);
    for (const d of bandArcSamples(band, -7)) expect(d).toBeCloseTo(70, 3);
    for (const d of bandArcSamples(band, 7)) expect(d).toBeCloseTo(84, 3);
  });

  it('legacy docs without circles build byte-identically', () => {
    const doc = ringDoc();
    // Strip the bindings: same stations/lines, no circle involvement.
    const stations = Object.fromEntries(
      Object.entries(doc.stations).map(([id, st]) => {
        const { circleId: _c, ...rest } = st;
        return [id, { ...rest, stops: rest.stops.map(({ viaCircle: _v, ...cell }) => cell) }];
      }),
    );
    const explicit = buildBandGeometry(stations, doc.lines, {});
    __resetSpecReuse();
    const defaulted = buildBandGeometry(stations, doc.lines);
    expect(defaulted.map((b) => b.paths)).toEqual(explicit.map((b) => b.paths));
  });
});

describe('the whole flow: bind, connect, arc', () => {
  it('connecting two bound stations in Edit Stops yields the arc with no extra steps', () => {
    // Raw stations near (not on) the rim, one line, one circle — then only
    // public transforms: bind both, add the first to the line, connect.
    let doc = makeDoc({
      stations: [makeStation({ id: 'a', x: 180, y: 110 }), makeStation({ id: 'b', x: 90, y: 180 })],
      lines: [makeLine({ id: 'l1' })],
      lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
    });
    doc = T.bindStationToCircle(doc, 'a', 'c1');
    doc = T.bindStationToCircle(doc, 'b', 'c1');
    doc = T.addStationToLine(doc, 'l1', 'a');
    doc = T.connectStationsOnLine(doc, 'l1', 'a', 'b');
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands).toHaveLength(1);
    expect(bands[0].paths[0]).toContain('A ');
    for (const d of bandArcSamples(bands[0], 0)) expect(d).toBeCloseTo(R, 3);
  });
});

describe('joint markers (arc meets octolinear at one stop)', () => {
  // s1 on the ring with an arc to s2 AND a straight edge east to n1: its
  // marker must paint BOTH travel frames — the exact tangent square (the arc
  // side) plus the octant square (the octolinear side) — or the joint shows a
  // wedge notch of up to (w/2)·tan 22.5° where the two band ends meet.
  function jointDoc(): MapDoc {
    return makeDoc({
      stations: [
        ringStation('s1', 0),
        ringStation('s2', Math.PI / 2, { rotation: 2 }),
        makeStation({ id: 'n1', x: 400, y: 100, stops: [makeStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['s2', 's1', 'n1'] })],
      lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
    });
  }

  it('a stop with an arc AND a straight edge carries the octant joint frame', () => {
    const doc = jointDoc();
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    const m1 = markers.find((m) => m.stationId === 's1');
    // Primary frame: the exact tangent (90° at the east point).
    expect(m1?.rotationDeg).toBeCloseTo(90, 9);
    // Joint frame: the octant travel axis, present only at the joint.
    expect(m1?.jointRotationDeg).not.toBeNull();
    // The arc-side pointer: s1 sits at the east point, its arc partner s2 at
    // the south point — the tangent axis is vertical, and the arc side is
    // DOWN (+y toward s2), so the half-squares split south/north.
    expect(m1?.jointArcOut).not.toBeNull();
    expect(m1!.jointArcOut!.x).toBeCloseTo(0, 6);
    expect(m1!.jointArcOut!.y).toBeCloseTo(1, 6);
  });

  it('a viaCircle stop with NO ridable edge falls back to the octant marker', () => {
    // Push s2's stop a cell radially out: the s1–s2 edge is BLOCKED (both
    // asked, radial mismatch) and s1's only other edge is straight — no arc
    // actually meets s1, so a tangent-rotated marker would poke out of two
    // octolinear bands for no reason. It reverts to the plain octant frame.
    const doc = jointDoc();
    const s2 = doc.stations.s2;
    const stations = {
      ...doc.stations,
      s2: { ...s2, stops: [{ ...s2.stops[0], col: 1 }] },
    };
    const bands = buildBandGeometry(stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(stations, doc.lines, ['l1'], bands, doc.lineCircles);
    const m1 = markers.find((m) => m.stationId === 's1');
    // Octant travel axis of an auto-vertical stop at rotation 0: 90° — and no
    // joint pieces at all.
    expect(m1?.rotationDeg).toBeCloseTo(90, 9);
    expect(m1?.jointRotationDeg).toBeNull();
    expect(m1?.jointArcOut).toBeNull();
  });

  it('a pure ring stop (every edge arcs) has NO joint frame', () => {
    const doc = ringDoc();
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    expect(markers.find((m) => m.stationId === 's1')?.jointRotationDeg).toBeNull();
    expect(markers.find((m) => m.stationId === 's2')?.jointRotationDeg).toBeNull();
  });

  it('a normal stop off the circle has no joint frame either', () => {
    const doc = jointDoc();
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    expect(markers.find((m) => m.stationId === 'n1')?.jointRotationDeg).toBeNull();
  });
});

describe('viaCircle stop markers', () => {
  it('rotate to the exact circle tangent, not the octant', () => {
    const doc = ringDoc();
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    const m1 = markers.find((m) => m.stationId === 's1');
    const m2 = markers.find((m) => m.stationId === 's2');
    // Tangent at angle 0 is (0, 1) → 90°; at π/2 it is (−1, 0) → 180°.
    expect(m1?.rotationDeg).toBeCloseTo(90, 9);
    expect(m2?.rotationDeg).toBeCloseTo(180, 9);
  });

  it('keep the octant rotation when the stop has not opted in', () => {
    const doc = ringDoc({
      stations: [
        ringStation('s1', 0, { viaCircle: false }),
        ringStation('s2', Math.PI / 2, { rotation: 2, viaCircle: false }),
      ],
    });
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    const m1 = markers.find((m) => m.stationId === 's1');
    // auto-vertical at rotation 0 travels along ±y → 90° (mod the square's
    // 4-fold symmetry), same as today.
    expect(m1?.rotationDeg).toBeCloseTo(90, 9);
  });

  it('an off-circle tangent marker at a non-octant angle is continuous', () => {
    const theta = 0.6; // nothing near an octant
    const doc = ringDoc({
      stations: [ringStation('s1', theta), ringStation('s2', theta + 1.2, { rotation: 2 })],
    });
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    const markers = buildStopMarkers(doc.stations, doc.lines, ['l1'], bands, doc.lineCircles);
    const m1 = markers.find((m) => m.stationId === 's1');
    // angleDeg(tangentAtAngle(0.6)) = atan2(cos 0.6, −sin 0.6) in degrees.
    const expected = (Math.atan2(Math.cos(theta), -Math.sin(theta)) * 180) / Math.PI;
    expect(m1?.rotationDeg).toBeCloseTo(expected, 6);
  });
});

// A ring's lanes are RADIAL, but a bound station's cell lattice is rotated to
// the nearest OCTANT — up to 22.5° apart. A lane-1 stop therefore lands at
// R + 14·cos(err), so the same lane index resolves to a different radius at
// every angle, and both circle gates (the segCircleFit arc test and the
// forEachPackedRun merge test) compare those radii against BAND_MERGE_TOL.
// Lane 0 is immune (zero offset, nothing to quantize) — which is why single-
// line rings always worked and hid this.
describe('interlined rings hold their lanes at ANY angle, not just the octants', () => {
  // Two bound stations carrying the same two lines, built only through public
  // transforms so the stops are placed by the app's own spawn logic.
  function twoLineRing(deg1: number, deg2: number): MapDoc {
    const rad = (d: number) => (d * Math.PI) / 180;
    const at = (d: number) => ({
      x: CX + R * Math.cos(rad(d)),
      y: CY + R * Math.sin(rad(d)),
    });
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', ...at(deg1), stops: [] }),
        makeStation({ id: 'b', ...at(deg2), stops: [] }),
      ],
      lines: [makeLine({ id: 'l1', stations: [] }), makeLine({ id: 'l2', stations: [] })],
      lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
    });
    doc = T.bindStationToCircle(doc, 'a', 'c1');
    doc = T.bindStationToCircle(doc, 'b', 'c1');
    doc = T.addStationToLine(doc, 'l1', 'a');
    doc = T.connectStationsOnLine(doc, 'l1', 'a', 'b');
    doc = T.addStationToLine(doc, 'l2', 'a');
    doc = T.connectStationsOnLine(doc, 'l2', 'a', 'b');
    return doc;
  }

  const stopRadius = (doc: MapDoc, sid: string, lid: string): number => {
    const st = doc.stations[sid];
    return distFromCenter(
      stopPosWorld(st.stops.find((c) => c.lineId === lid)!, st, doc.lineCircles),
    );
  };

  it('puts both ends of a lane on ONE radius at a non-octant angle', () => {
    // 22° is the worst case: its tangent quantizes a full 22° away, shrinking
    // the radial step from 14 to 14·cos 22° while the 0° end keeps the full 14.
    const doc = twoLineRing(0, 22);
    expect(stopRadius(doc, 'a', 'l1')).toBeCloseTo(R, 9);
    expect(stopRadius(doc, 'b', 'l1')).toBeCloseTo(R, 9);
    expect(stopRadius(doc, 'a', 'l2')).toBeCloseTo(R + STOP_SIZE, 9);
    expect(stopRadius(doc, 'b', 'l2')).toBeCloseTo(R + STOP_SIZE, 9);
  });

  it('routes the lane-1 arc instead of warning', () => {
    const doc = twoLineRing(0, 22);
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands.some((b) => b.warning)).toBe(false);
  });

  it('still MERGES the two lanes into one packed band off the octants', () => {
    // 10°/100° passes the arc gate today (both ends quantize identically) but
    // fails the packing gate — the radial step is 13.81, not 14 — so the pair
    // silently renders as two independent single-stripe bands.
    const doc = twoLineRing(10, 100);
    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(bands[0].stripeOffsets).toEqual([-7, 7]);
    for (const d of bandArcSamples(bands[0], -7)) expect(d).toBeCloseTo(R, 3);
    for (const d of bandArcSamples(bands[0], 7)) expect(d).toBeCloseTo(R + STOP_SIZE, 3);
  });

  it('survives dragging a bound station all the way around the ring', () => {
    const base = twoLineRing(0, 90);
    const broken: number[] = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const p = {
        x: CX + R * Math.cos((deg * Math.PI) / 180),
        y: CY + R * Math.sin((deg * Math.PI) / 180),
      };
      const doc = T.moveStation(base, 'b', p.x, p.y);
      __resetSpecReuse();
      if (buildBandGeometry(doc.stations, doc.lines, doc.lineCircles).some((x) => x.warning)) {
        broken.push(deg);
      }
    }
    expect(broken).toEqual([]);
  });
});

// Geometry reduced from a real broken map: two ring stations whose seats put
// radial-out on OPPOSITE local axes (rotation 1 with the lane at col −1,
// rotation 7 with it at col +1), and whose tangents quantize by different
// amounts (5.1° vs 17.0°). Under the octant frame that spread the lane across
// two radii 0.52 apart — just past BAND_MERGE_TOL, so the arc was refused.
describe('a lane spanning opposite radial-local turns still rides one radius', () => {
  const RC = { x: -24.665771504350346, y: -69.64362260937475, radius: 186.25 };

  it('resolves both ends onto R + one lane and routes the arc', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'university',
          x: -167.3781613179745,
          y: -189.31916853954456,
          rotation: 1,
          circleId: 'c1',
          stops: [makeStop('B', { viaCircle: true }), makeStop('A', { col: -1, viaCircle: true })],
        }),
        makeStation({
          id: 'russell',
          x: 62.73827473927592,
          y: -234.11123401126153,
          rotation: 7,
          circleId: 'c1',
          stops: [makeStop('B', { viaCircle: true }), makeStop('A', { col: 1, viaCircle: true })],
        }),
      ],
      lines: [
        makeLine({ id: 'B', stations: ['university', 'russell'] }),
        makeLine({ id: 'A', stations: ['university', 'russell'] }),
      ],
      lineCircles: [makeLineCircle({ id: 'c1', ...RC })],
    });
    const radius = (sid: string, lid: string): number => {
      const st = doc.stations[sid];
      const p = stopPosWorld(st.stops.find((c) => c.lineId === lid)!, st, doc.lineCircles);
      return Math.hypot(p.x - RC.x, p.y - RC.y);
    };
    expect(radius('university', 'B')).toBeCloseTo(RC.radius, 9);
    expect(radius('russell', 'B')).toBeCloseTo(RC.radius, 9);
    expect(radius('university', 'A')).toBeCloseTo(RC.radius + STOP_SIZE, 9);
    expect(radius('russell', 'A')).toBeCloseTo(RC.radius + STOP_SIZE, 9);

    const bands = buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);
    expect(bands.some((b) => b.warning)).toBe(false);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeOffsets).toEqual([-7, 7]);
  });
});
