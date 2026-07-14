import { describe, it, expect } from 'vitest';
import { buildBands } from './interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// GOLDEN PINS for band geometry. The per-line-width work reroutes every band
// path through generalized offset math (stripeOffsetsForWidths & co.); these
// snapshots freeze the BYTE-EXACT output of buildBands for all-default-width
// docs BEFORE that refactor. The rest of the suite pins counts/radii only —
// a 1-ULP drift in offset math would slide every painted path on every
// existing map while staying green there. If one of these ever changes, the
// zero-visual-change-for-legacy-docs invariant is broken; do not update the
// snapshot without understanding exactly why.
//
// (Recorded green-on-arrival by design — this is a refactor-under-green net,
// not a red-first unit.)

const golden = (bands: ReturnType<typeof buildBands>) =>
  bands.map((b) => ({
    bandKey: b.bandKey,
    radius: b.radius,
    warning: b.warning,
    centerline: b.centerline,
    paths: b.paths,
  }));

const fiveStripeStations = (s1: { x: number; y: number }, s2: { x: number; y: number }) => [
  makeStation({
    id: 's1',
    ...s1,
    stops: [
      makeStop('L1', { col: 0 }),
      makeStop('L2', { col: 1 }),
      makeStop('L3', { col: 2 }),
      makeStop('L4', { col: 3 }),
      makeStop('L5', { col: 4 }),
    ],
  }),
  makeStation({
    id: 's2',
    ...s2,
    stops: [
      makeStop('L1', { col: 0 }),
      makeStop('L2', { col: 1 }),
      makeStop('L3', { col: 2 }),
      makeStop('L4', { col: 3 }),
      makeStop('L5', { col: 4 }),
    ],
  }),
];
const fiveStripeLines = () =>
  ['L1', 'L2', 'L3', 'L4', 'L5'].map((id) =>
    makeLine({ id, stations: ['s1', 's2'], curveRadius: 20 }),
  );

describe('buildBands — golden geometry pins (all-default widths)', () => {
  it('straight 5-stripe band', () => {
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 0, y: 200 }),
      lines: fiveStripeLines(),
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  it('5-stripe Z-bend with ample edges (cap inactive)', () => {
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 96, y: 120 }),
      lines: fiveStripeLines(),
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  it('5-stripe Z-bend with tight edges (marker-fit cap engaged)', () => {
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 96, y: 100 }),
      lines: fiveStripeLines(),
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  it('diagonal merged pair', () => {
    const H = Math.SQRT1_2;
    const stops = (lineIds: [string, string]) => [
      makeStop(lineIds[0], { row: 0, col: 0, orientation: 'auto-ne-sw' }),
      makeStop(lineIds[1], { row: H, col: H, orientation: 'auto-ne-sw' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, rotation: 0, stops: stops(['L1', 'L2']) }),
        makeStation({ id: 's2', x: 100, y: -100, rotation: 0, stops: stops(['L1', 'L2']) }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  // Loop/branch topology (PR #234) had no golden band-geometry coverage. These
  // pin the routed paths for a junction and a loop so a change to buildBands
  // can't silently slide them. (Geometry only — casing is a render concern.)
  const hStation = (id: string, x: number, y: number) =>
    makeStation({ id, x, y, stops: [makeStop('L1', { orientation: 'auto-horizontal' })] });

  it('degree-3 junction: through-line a-j-c plus branch j-d', () => {
    const doc = makeDoc({
      stations: [
        hStation('a', -120, 0),
        hStation('c', 120, 0),
        hStation('d', 120, -120),
        hStation('j', 0, 0),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'j', 'c', 'd'], edges: ['a|j', 'c|j', 'd|j'] })],
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  it('3-cycle loop: triangle a-b-c', () => {
    const doc = makeDoc({
      stations: [hStation('a', 0, 0), hStation('b', 160, 0), hStation('c', 80, 90)],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'], edges: ['a|b', 'b|c', 'a|c'] })],
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });

  it('cramped single-stripe perpendicular terminus (cap below R)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
        makeStation({
          id: 's2',
          x: 24,
          y: -37,
          rotation: 2,
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s2', 's1'] })],
    });
    expect(golden(buildBands(doc.stations, doc.lines, doc.lineOrder))).toMatchSnapshot();
  });
});
