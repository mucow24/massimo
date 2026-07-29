import { beforeEach, describe, expect, it } from 'vitest';
import { makeDoc, makeLineCircle, makeLine, makeStation, makeStop } from '../test/fixtures';
import {
  __resetSpecReuse,
  buildBandGeometry,
  buildStopMarkers,
  type SegmentBandSpec,
} from './interlining';
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

  it('falls back to octolinear when the radial offsets disagree between the ends', () => {
    // s2's stop is pushed one cell radially outward (col 1 at rotation 2 =
    // world +y = radially out at the south point); s1's stays on the circle.
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
      stations: [
        makeStation({ id: 'a', x: 180, y: 110 }),
        makeStation({ id: 'b', x: 90, y: 180 }),
      ],
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
