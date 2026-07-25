import { describe, it, expect } from 'vitest';
import { buildBands, buildStopMarkers } from '../geometry/interlining';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';

// Two lines share the corridor s1|s2 but traverse it on DIFFERENT world axes
// at each end, so buildBands emits TWO sibling bands with the same pairKey
// "s1|s2" (the documented sibling-band case pinned by
// `buildBands — bandKey identity`, interlining.test.ts:842).
//
// Each line's single edge makes both stations degree-1 termini, so every
// marker asks terminusOutwardFromBand for a tangent.
//
//   L1 band centerline: (0,0) -> (185.94,0) -> (200,14.06) -> (200,200)
//     leaves s1 heading EAST   => outward at s1 = (-1, 0)
//     arrives s2 heading SOUTH => outward at s2 = ( 0, 1)
//
//   L2 band centerline: (0,28) -> (0,213.94) -> (14.06,228) -> (200,228)
//     leaves s1 heading SOUTH => outward at s1 = ( 0,-1)
//     arrives s2 heading EAST => outward at s2 = ( 1, 0)
const doc = () =>
  makeDoc({
    stations: [
      makeStation({
        id: 's1',
        x: 0,
        y: 0,
        stops: [
          makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
          makeStop('L2', { row: 2, col: 0, orientation: 'auto-vertical' }),
        ],
      }),
      makeStation({
        id: 's2',
        x: 200,
        y: 200,
        stops: [
          makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
          makeStop('L2', { row: 2, col: 0, orientation: 'auto-horizontal' }),
        ],
      }),
    ],
    lines: [
      makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      makeLine({ id: 'L2', stations: ['s1', 's2'] }),
    ],
  });

const markersFor = () => {
  const d = doc();
  const bands = buildBands(d.stations, d.lines, d.lineOrder);
  // Precondition: this really is the sibling-band shape (same pairKey, one
  // band per line). If this ever stops holding the test below is vacuous.
  expect(bands).toHaveLength(2);
  expect(bands[0].pairKey).toBe(bands[1].pairKey);
  expect(bands.map((b) => b.lines.map((l) => l.id).join(','))).toEqual(['L1', 'L2']);
  return buildStopMarkers(d.stations, d.lines, d.lineOrder, bands);
};

const outwardOf = (ms: ReturnType<typeof markersFor>, lineId: string, stationId: string) => {
  const m = ms.find((x) => x.lineId === lineId && x.stationId === stationId);
  expect(m, `no marker for ${lineId}@${stationId}`).toBeDefined();
  return m!.outward;
};

describe('terminus outward must come from the marker line OWN band', () => {
  it("L1's terminus tangents follow L1's band, not the sibling band that won the pairKey map", () => {
    const ms = markersFor();

    // L1 leaves s1 heading east, so its end cap / cap-extension points west.
    expect(outwardOf(ms, 'L1', 's1')).toEqual({ x: -1, y: 0 });
    // L1 arrives at s2 heading south, so its outward points south.
    expect(outwardOf(ms, 'L1', 's2')).toEqual({ x: 0, y: 1 });
  });

  it("L2's terminus tangents follow L2's band (control: currently correct)", () => {
    const ms = markersFor();

    expect(outwardOf(ms, 'L2', 's1')).toEqual({ x: 0, y: -1 });
    expect(outwardOf(ms, 'L2', 's2')).toEqual({ x: 1, y: 0 });
  });

  it('no two lines with perpendicular approaches share an outward vector', () => {
    const ms = markersFor();
    // L1 and L2 approach s1 on perpendicular axes, so their outward vectors
    // must be perpendicular (dot == 0), never identical.
    const a = outwardOf(ms, 'L1', 's1')!;
    const b = outwardOf(ms, 'L2', 's1')!;
    expect(a.x * b.x + a.y * b.y).toBeCloseTo(0, 9);
  });
});
