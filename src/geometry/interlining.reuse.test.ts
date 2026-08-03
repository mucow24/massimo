import { describe, it, expect, beforeEach } from 'vitest';
import {
  BAND_SPEC_FIELDS,
  MARKER_SPEC_FIELDS,
  __resetSpecReuse,
  buildBandGeometry,
  buildBands,
  buildStopMarkers,
  withLinePriorities,
  type SegmentBandSpec,
  type StopMarkerSpec,
} from './interlining';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { Line } from '../model/types';

// Identity-stable spec reuse: buildBandGeometry / buildStopMarkers hand back
// the PREVIOUS build's spec object wherever the new one is value-identical
// over every consumed field, so identity is a truthful "geometry unchanged"
// signal for the React memos and the identity-keyed caches downstream.

// Two disjoint corridors: l1 on a–b, l2 on c–d. `dx` shifts station d so a
// rebuild changes ONLY the c–d corridor's geometry.
const twoCorridors = (dx = 0) =>
  makeDoc({
    stations: [
      stationWithStop('a', 'l1', { x: 0, y: 0 }),
      stationWithStop('b', 'l1', { x: 200, y: 0 }),
      stationWithStop('c', 'l2', { x: 0, y: 300 }),
      stationWithStop('d', 'l2', { x: 200 + dx, y: 300 }),
    ],
    lines: [
      makeLine({ id: 'l1', stations: ['a', 'b'] }),
      makeLine({ id: 'l2', stations: ['c', 'd'], color: '#EE352E' }),
    ],
  });

// Two lines interlined on the same vertical a–b corridor at cols 0/1. `swap`
// flips which line sits at which col: same stations, same stop positions,
// same sorted line-id set — so the bandKey is IDENTICAL while every stripe
// cover inverts. The classic stripe-slot-swap trap.
const interlined = (swap: boolean) => {
  const stops = () =>
    swap
      ? [makeStop('l1', { col: 1 }), makeStop('l2', { col: 0 })]
      : [makeStop('l1', { col: 0 }), makeStop('l2', { col: 1 })];
  return makeDoc({
    stations: [
      makeStation({ id: 'a', x: 0, y: 0, stops: stops() }),
      makeStation({ id: 'b', x: 0, y: 200, stops: stops() }),
    ],
    lines: [
      makeLine({ id: 'l1', stations: ['a', 'b'] }),
      makeLine({ id: 'l2', stations: ['a', 'b'], color: '#EE352E' }),
    ],
  });
};

const bandByKey = (bands: SegmentBandSpec[], key: string): SegmentBandSpec => {
  const b = bands.find((x) => x.bandKey === key);
  if (!b) throw new Error(`no band ${key}`);
  return b;
};

const markerAt = (markers: StopMarkerSpec[], stationId: string): StopMarkerSpec => {
  const m = markers.find((x) => x.stationId === stationId);
  if (!m) throw new Error(`no marker at ${stationId}`);
  return m;
};

beforeEach(() => {
  __resetSpecReuse();
});

describe('spec reuse — identity across rebuilds', () => {
  it('a one-station move keeps the previous specs for untouched geometry, fresh for touched', () => {
    const d1 = twoCorridors();
    const bands1 = buildBandGeometry(d1.stations, d1.lines);
    const markers1 = buildStopMarkers(d1.stations, d1.lines, d1.lineOrder, bands1);

    const d2 = twoCorridors(10); // move station d
    const bands2 = buildBandGeometry(d2.stations, d2.lines);
    const markers2 = buildStopMarkers(d2.stations, d2.lines, d2.lineOrder, bands2);

    // The untouched corridor's band is the SAME object as last build's.
    expect(bandByKey(bands2, 'a|b#l1')).toBe(bandByKey(bands1, 'a|b#l1'));
    // The moved corridor's band is fresh (its centerline changed).
    expect(bandByKey(bands2, 'c|d#l2')).not.toBe(bandByKey(bands1, 'c|d#l2'));

    // Markers away from the move reuse; the moved station's marker is fresh.
    expect(markerAt(markers2, 'a')).toBe(markerAt(markers1, 'a'));
    expect(markerAt(markers2, 'b')).toBe(markerAt(markers1, 'b'));
    expect(markerAt(markers2, 'd')).not.toBe(markerAt(markers1, 'd'));
    // c sits on the moved corridor but every marker field (position, outward
    // terminus tangent, …) is value-identical — reuse is by VALUE, not by
    // which corridor was touched.
    expect(markerAt(markers2, 'c')).toBe(markerAt(markers1, 'c'));
  });

  it('reused output is value-identical to a cache-free rebuild — paths included', () => {
    const d1 = twoCorridors();
    buildStopMarkers(d1.stations, d1.lines, d1.lineOrder, buildBandGeometry(d1.stations, d1.lines));

    const d2 = twoCorridors(10);
    const bands2 = buildBandGeometry(d2.stations, d2.lines);
    const markers2 = buildStopMarkers(d2.stations, d2.lines, d2.lineOrder, bands2);

    __resetSpecReuse();
    const bandsCold = buildBandGeometry(d2.stations, d2.lines);
    const markersCold = buildStopMarkers(d2.stations, d2.lines, d2.lineOrder, bandsCold);

    expect(bands2).toEqual(bandsCold);
    expect(markers2).toEqual(markersCold);
    // The equality skips `paths` as derived-from-compared-inputs; this pins
    // the determinism that makes that skip safe: a reused spec's paths equal
    // what a from-scratch build would have produced.
    expect(bandByKey(bands2, 'a|b#l1').paths).toEqual(bandByKey(bandsCold, 'a|b#l1').paths);
  });
});

describe('spec reuse — value changes mint fresh specs', () => {
  it('two lines swapping stripe slots under an identical bandKey do NOT reuse', () => {
    const d1 = interlined(false);
    const bands1 = buildBandGeometry(d1.stations, d1.lines);
    expect(bands1).toHaveLength(1);

    const d2 = interlined(true);
    const bands2 = buildBandGeometry(d2.stations, d2.lines);
    expect(bands2).toHaveLength(1);

    // The trap scenario really is constructed: same key, inverted slots.
    expect(bands2[0].bandKey).toBe(bands1[0].bandKey);
    expect(bands2[0].lines.map((l) => l.id)).toEqual(bands1[0].lines.map((l) => l.id).reverse());

    expect(bands2[0]).not.toBe(bands1[0]);
  });

  it('a width edit rebuilds that corridor; other corridors still reuse', () => {
    const d1 = twoCorridors();
    const bands1 = buildBandGeometry(d1.stations, d1.lines);
    const markers1 = buildStopMarkers(d1.stations, d1.lines, d1.lineOrder, bands1);

    const lines2 = { ...d1.lines, l1: { ...d1.lines.l1, width: 12 } };
    const bands2 = buildBandGeometry(d1.stations, lines2);
    const markers2 = buildStopMarkers(d1.stations, lines2, d1.lineOrder, bands2);

    const widened = bandByKey(bands2, 'a|b#l1');
    expect(widened).not.toBe(bandByKey(bands1, 'a|b#l1'));
    expect(widened.stripeWidths).toEqual([12]);
    expect(bandByKey(bands2, 'c|d#l2')).toBe(bandByKey(bands1, 'c|d#l2'));

    expect(markerAt(markers2, 'a')).not.toBe(markerAt(markers1, 'a'));
    expect(markerAt(markers2, 'c')).toBe(markerAt(markers1, 'c'));
  });

  it('marker value edits — color, priority via lineOrder, end style — mint fresh markers', () => {
    const d = twoCorridors();
    const bands = buildBandGeometry(d.stations, d.lines);
    const m1 = buildStopMarkers(d.stations, d.lines, d.lineOrder, bands);

    // Color edit on l1: its markers go fresh, l2's reuse.
    const recolored: Record<string, Line> = {
      ...d.lines,
      l1: { ...d.lines.l1, color: '#FF6319' },
    };
    const m2 = buildStopMarkers(d.stations, recolored, d.lineOrder, bands);
    expect(markerAt(m2, 'a')).not.toBe(markerAt(m1, 'a'));
    expect(markerAt(m2, 'c')).toBe(markerAt(m1, 'c'));

    // Layer reorder: every marker's baked priority flips, all fresh.
    const m3 = buildStopMarkers(d.stations, recolored, ['l2', 'l1'], bands);
    expect(markerAt(m3, 'a')).not.toBe(markerAt(m2, 'a'));
    expect(markerAt(m3, 'c')).not.toBe(markerAt(m2, 'c'));

    // End-style edit on l2: only that line's terminus markers go fresh.
    const rounded: Record<string, Line> = {
      ...recolored,
      l2: { ...recolored.l2, endStyle: 'round' },
    };
    const m4 = buildStopMarkers(d.stations, rounded, ['l2', 'l1'], bands);
    expect(markerAt(m4, 'c')).not.toBe(markerAt(m3, 'c'));
    expect(markerAt(m4, 'c').end).toBe('round');
    expect(markerAt(m4, 'a')).toBe(markerAt(m3, 'a'));
  });
});

describe('spec reuse — mutation discipline', () => {
  it('buildBands stamps priorities without mutating the shared pristine specs', () => {
    const d = twoCorridors();
    const geo = buildBandGeometry(d.stations, d.lines);
    const stamped = buildBands(d.stations, d.lines, d.lineOrder);

    expect(bandByKey(stamped, 'a|b#l1').linePriorities).toEqual([0]);
    expect(bandByKey(stamped, 'c|d#l2').linePriorities).toEqual([1]);
    // buildBands' internal geometry build reuses the SAME cached objects
    // `geo` holds; an in-place stamp would leak priorities onto them.
    expect(geo.every((b) => b.linePriorities.length === 0)).toBe(true);
  });
});

describe('withLinePriorities', () => {
  it('stamps assignLinePriorities semantics onto clones; pristine input stays pristine', () => {
    const d = twoCorridors();
    const geo = buildBandGeometry(d.stations, d.lines);
    const stamped = withLinePriorities(geo, d.lines, ['l2', 'l1']);
    expect(bandByKey(stamped, 'a|b#l1').linePriorities).toEqual([1]);
    expect(bandByKey(stamped, 'c|d#l2').linePriorities).toEqual([0]);
    expect(geo.every((b) => b.linePriorities.length === 0)).toBe(true);
  });

  it('hands back the SAME clone while pristine identity and priorities hold', () => {
    const d = twoCorridors();
    const geo = buildBandGeometry(d.stations, d.lines);
    const s1 = withLinePriorities(geo, d.lines, d.lineOrder);
    const s2 = withLinePriorities(geo, d.lines, d.lineOrder);
    s1.forEach((b, i) => expect(s2[i]).toBe(b));

    // Across a rebuild whose specs the reuse layer kept, the stamped clones
    // keep their identity too — this is what lets SegmentBand's memo bail
    // out for clean corridors mid-drag.
    const geo2 = buildBandGeometry(d.stations, d.lines);
    const s3 = withLinePriorities(geo2, d.lines, d.lineOrder);
    s1.forEach((b, i) => expect(s3[i]).toBe(b));

    // A lineOrder change mints new clones carrying the new priorities.
    const s4 = withLinePriorities(geo, d.lines, ['l2', 'l1']);
    expect(s4[0]).not.toBe(s1[0]);
    expect(bandByKey(s4, 'a|b#l1').linePriorities).toEqual([1]);
  });
});

describe('spec reuse — field-drift guard', () => {
  // A new spec field must show up in the classification table (compile-time
  // `satisfies` in interlining.ts) AND here — so it cannot ship without a
  // decision on how the equality treats it. A field the equality misses would
  // serve a stale spec under a fresh-looking identity.
  it('every built SegmentBandSpec field is classified', () => {
    const d = twoCorridors();
    const band = buildBandGeometry(d.stations, d.lines)[0];
    const expected = [
      'bandKey',
      'centerline',
      'fromId',
      'linePriorities',
      'lines',
      'pairKey',
      'paths',
      'radius',
      'seamArms',
      'stripeOffsets',
      'stripeWidths',
      'toId',
      'warning',
    ];
    expect(Object.keys(band).sort()).toEqual(expected);
    expect(Object.keys(BAND_SPEC_FIELDS).sort()).toEqual(expected);
  });

  it('every built StopMarkerSpec field is classified', () => {
    const d = twoCorridors();
    const marker = buildStopMarkers(d.stations, d.lines, d.lineOrder)[0];
    const expected = [
      'color',
      'cx',
      'cy',
      'end',
      'jointArcOut',
      'jointRotationDeg',
      'lineId',
      'outward',
      'priority',
      'rotationDeg',
      'stationId',
      'style',
      'width',
    ];
    expect(Object.keys(marker).sort()).toEqual(expected);
    expect(Object.keys(MARKER_SPEC_FIELDS).sort()).toEqual(expected);
  });
});
