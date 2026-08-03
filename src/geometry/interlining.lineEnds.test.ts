import { describe, it, expect } from 'vitest';
import { buildBands, buildStopMarkers, lineEndsAt } from './interlining';
import {
  makeDoc,
  makeLine,
  makeLineCircle,
  makeStation,
  makeStop,
  stationWithStop,
} from '../test/fixtures';
import type { MapDoc, Rotation } from '../model/types';

// `lineEndsAt` answers "does this line's ink END here" from the DOC alone, for
// the editors and the file loader — the same question `buildStopMarkers` asks
// of the built bands. The two must agree; the last test in this file is what
// keeps them honest.

// A line that branches at its own end: both edges leave `end` southward down
// one corridor, one carrying on to `far`, one peeling off to `off`.
const branchEnd = (): MapDoc =>
  makeDoc({
    stations: [
      stationWithStop('end', 'L1', { x: 0, y: 0 }),
      stationWithStop('far', 'L1', { x: 0, y: 600 }),
      stationWithStop('off', 'L1', { x: 200, y: 400 }, { orientation: 'auto-nw-se' }),
    ],
    lines: [makeLine({ id: 'L1', stations: ['end', 'far', 'off'], edges: ['end|far', 'end|off'] })],
  });

// A—B—C straight down: A and C are plain termini, B is a through stop.
const chain = (): MapDoc =>
  makeDoc({
    stations: [
      stationWithStop('A', 'L1', { x: 0, y: 0 }),
      stationWithStop('B', 'L1', { x: 0, y: 300 }),
      stationWithStop('C', 'L1', { x: 0, y: 600 }),
    ],
    lines: [makeLine({ id: 'L1', stations: ['A', 'B', 'C'] })],
  });

// A through stop that is NOT a straight line: `mid` is left westward by one
// edge and eastward by the other, the eastward corridor bending away south
// further along. Both halves of its marker are covered, so it is no end — the
// case a rule keying off degree alone would get right and one keying off
// "does the line bend here" would not.
//
// (A 90° turn AT a station is not a shape this app can route: a band leaves
// along the stop's travel axis, so a neighbour off that axis is reached by
// bending AFTER the station, never at it.)
const through = (): MapDoc =>
  makeDoc({
    stations: [
      stationWithStop('mid', 'L1', { x: 0, y: 0 }, { orientation: 'auto-horizontal' }),
      stationWithStop('west', 'L1', { x: -600, y: 0 }, { orientation: 'auto-horizontal' }),
      stationWithStop('southeast', 'L1', { x: 600, y: 600 }),
    ],
    lines: [
      makeLine({
        id: 'L1',
        stations: ['mid', 'west', 'southeast'],
        edges: ['mid|west', 'mid|southeast'],
      }),
    ],
  });

// An ARC family: three stations bound to a line circle, riding it. Their bands
// are circular arcs, so the painted centerline is a sampled polyline whose
// first chord is NOT the travel axis this rule reads — the one band family
// where the two answers could come apart on healthy geometry. `east` and
// `south` are the ends; `southeast` between them is a through stop.
const RING = { x: 100, y: 100, r: 70 };
const onRing = (id: string, theta: number, rotation: Rotation) =>
  makeStation({
    id,
    x: RING.x + RING.r * Math.cos(theta),
    y: RING.y + RING.r * Math.sin(theta),
    rotation,
    circleId: 'c1',
    stops: [makeStop('L1', { viaCircle: true })],
  });
const arcs = (): MapDoc =>
  makeDoc({
    stations: [
      onRing('east', 0, 0),
      onRing('southeast', Math.PI / 4, 1),
      onRing('south', Math.PI / 2, 2),
    ],
    lines: [makeLine({ id: 'L1', stations: ['east', 'southeast', 'south'] })],
    lineCircles: [makeLineCircle({ id: 'c1', x: RING.x, y: RING.y, radius: RING.r })],
  });

// A triangle whose apex is a hairpin — both corridors leave it the same way.
const cuspLoop = (): MapDoc =>
  makeDoc({
    stations: [
      stationWithStop('apex', 'L1', { x: 0, y: 0 }),
      stationWithStop('down', 'L1', { x: 0, y: 100 }),
      stationWithStop('side', 'L1', { x: 100, y: 100 }),
    ],
    lines: [
      makeLine({
        id: 'L1',
        stations: ['apex', 'down', 'side'],
        edges: ['apex|down', 'down|side', 'apex|side'],
      }),
    ],
  });

const endsAt = (doc: MapDoc, stationId: string) =>
  lineEndsAt(doc.stations, doc.lines.L1, stationId);

describe('lineEndsAt', () => {
  it('ends a plain terminus, not the stop between', () => {
    const doc = chain();
    expect(endsAt(doc, 'A')).toBe(true);
    expect(endsAt(doc, 'C')).toBe(true);
    expect(endsAt(doc, 'B')).toBe(false);
  });

  it('ends a station the line BRANCHES at, both edges leaving the same way', () => {
    expect(endsAt(branchEnd(), 'end')).toBe(true);
  });

  it('does not end a through stop whose corridors bend away', () => {
    expect(endsAt(through(), 'mid')).toBe(false);
  });

  it('ends the cusp of a loop', () => {
    const doc = cuspLoop();
    expect(endsAt(doc, 'apex')).toBe(true);
    expect(endsAt(doc, 'down')).toBe(false);
  });

  it('cannot see a band the router gave up on — the one place it may disagree', () => {
    // `down|side` is unroutable (two vertical stops separated horizontally), so
    // it WARNS and paints a straight from station to station. That straight
    // leaves `side` heading east, which the marker reads and this rule cannot:
    // it only knows travel axes, and by those both of `side`'s edges leave the
    // same way. The pin it offers there is inert until the warning is fixed —
    // which the red frame and ⚠ on the canvas are already asking for.
    const doc = cuspLoop();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    expect(bands.find((b) => b.pairKey === 'down|side')?.warning).toBe(true);
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
    expect(markers.find((m) => m.stationId === 'side')?.outward).toBeNull();
    expect(endsAt(doc, 'side')).toBe(true);
  });

  it('ends a ring the same way, though an arc leaves along a chord', () => {
    const doc = arcs();
    // Precondition: these really are ARCS. A straight band would make the
    // agreement below the same one the octolinear shapes already prove.
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder, doc.lineCircles);
    expect(bands).toHaveLength(2);
    for (const b of bands) expect(b.centerline.length).toBeGreaterThan(2);
    const ends = (id: string) => lineEndsAt(doc.stations, doc.lines.L1, id);
    expect(ends('east')).toBe(true);
    expect(ends('south')).toBe(true);
    expect(ends('southeast')).toBe(false);
  });

  it('ends nothing with no edge to end along', () => {
    const lone = makeDoc({
      stations: [stationWithStop('A', 'L1', { x: 0, y: 0 })],
      lines: [makeLine({ id: 'L1', stations: ['A'] })],
    });
    expect(endsAt(lone, 'A')).toBe(false);
    // A neighbour that renders no band covers nothing — but it also leaves no
    // heading to end along, so a stop reached only that way is not an end.
    const dangling = makeDoc({
      stations: [stationWithStop('A', 'L1', { x: 0, y: 0 })],
      lines: [makeLine({ id: 'L1', stations: ['A', 'ghost'], edges: ['A|ghost'] })],
    });
    expect(endsAt(dangling, 'A')).toBe(false);
    // Not a member of the line at all.
    expect(endsAt(chain(), 'nope')).toBe(false);
  });

  // THE GUARD. Two predicates asking one question is a drift trap, so this
  // walks every stop of every shape above and demands the doc-side answer match
  // the band-side one (`spec.outward != null`) exactly. Stations touching a
  // WARNED band are the one exemption, for the reason the test above pins.
  it('agrees with the marker specs built from the bands, shape for shape', () => {
    let checked = 0;
    for (const [name, doc] of Object.entries({
      chain: chain(),
      branchEnd: branchEnd(),
      through: through(),
      arcs: arcs(),
      cuspLoop: cuspLoop(),
    })) {
      const bands = buildBands(doc.stations, doc.lines, doc.lineOrder, doc.lineCircles);
      const unroutable = new Set<string>();
      for (const b of bands) if (b.warning) unroutable.add(b.fromId).add(b.toId);
      const markers = buildStopMarkers(
        doc.stations,
        doc.lines,
        doc.lineOrder,
        bands,
        doc.lineCircles,
      );
      expect(markers.length, `${name} built no markers`).toBeGreaterThan(0);
      for (const m of markers) {
        if (unroutable.has(m.stationId)) continue;
        checked++;
        expect(
          lineEndsAt(doc.stations, doc.lines[m.lineId], m.stationId),
          `${name} @ ${m.stationId}`,
        ).toBe(m.outward !== null);
      }
    }
    // Not vacuous: every shape above contributed stops to the comparison.
    expect(checked).toBe(13);
  });
});
