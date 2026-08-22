import { describe, it, expect } from 'vitest';
import {
  pushLineCircleGeomSig,
  pushLineGeomSig,
  pushStationGeomSig,
  buildBandGeometry,
} from './interlining';
import { makeLine, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import type { Line, LineCircle, LineId, Station } from '../model/types';

/**
 * These three emitters ARE the answer to "has the band geometry changed?" —
 * MapCanvas's memo keys and `regionGeometrySig` both build their hash from
 * them. So the pins that matter are both directions: a field buildBandGeometry
 * READS has to move the hash (or an edit never repaints and never invalidates
 * the region cache), and a field it is blind to must not (or every colour edit
 * re-routes the whole map and drops every cached face).
 *
 * The routing itself is the referee for that second half: where a field is
 * claimed presentation, the test asserts buildBandGeometry emits the identical
 * paths across the edit, so "not in the hash" can never quietly become wrong.
 */

const sigOf = (fill: (parts: string[]) => void): string => {
  const parts: string[] = [];
  fill(parts);
  return parts.join('|');
};

const stationSig = (st: Station): string => sigOf((p) => pushStationGeomSig(p, st.id, st));
const lineSig = (ln: Line): string => sigOf((p) => pushLineGeomSig(p, ln.id, ln));
const circleSig = (c: LineCircle): string => sigOf((p) => pushLineCircleGeomSig(p, c.id, c));

const baseStation = (): Station =>
  makeStation({ id: 's1', x: 10, y: 20, stops: [makeStop('l1', { row: 1, col: 2 })] });

const baseLine = (): Line =>
  makeLine({ id: 'l1' as LineId, stations: ['s1', 's2'], width: 14, curveRadius: 24 });

describe('pushStationGeomSig', () => {
  it('moves for every station field the band routing reads', () => {
    const base = baseStation();
    const sig = stationSig(base);
    expect(stationSig({ ...base, x: 11 })).not.toBe(sig);
    expect(stationSig({ ...base, y: 21 })).not.toBe(sig);
    expect(stationSig({ ...base, rotation: 2 })).not.toBe(sig);
    expect(stationSig({ ...base, circleId: 'c1' })).not.toBe(sig);
    expect(stationSig({ ...base, stops: [makeStop('l2', { row: 1, col: 2 })] })).not.toBe(sig);
    expect(stationSig({ ...base, stops: [makeStop('l1', { row: 9, col: 2 })] })).not.toBe(sig);
    expect(stationSig({ ...base, stops: [makeStop('l1', { row: 1, col: 9 })] })).not.toBe(sig);
    expect(
      stationSig({
        ...base,
        stops: [makeStop('l1', { row: 1, col: 2, orientation: 'auto-horizontal' })],
      }),
    ).not.toBe(sig);
    expect(
      stationSig({ ...base, stops: [makeStop('l1', { row: 1, col: 2, viaCircle: true })] }),
    ).not.toBe(sig);
    // A station's id is part of its own entry — a rename is a different map.
    expect(sigOf((p) => pushStationGeomSig(p, 's2', base))).not.toBe(sig);
  });

  it('holds still for the label block and per-stop presentation', () => {
    // The high-frequency writers: an Alt fine-drag streams label offsets per
    // pointermove, and those must repaint the label without re-routing bands.
    const base = baseStation();
    const sig = stationSig(base);
    expect(stationSig({ ...base, label: { ...base.label, offset: 12, offsetPerp: 3 } })).toBe(sig);
    expect(stationSig({ ...base, name: 'Renamed' })).toBe(sig);
    expect(stationSig({ ...base, locked: true })).toBe(sig);
    expect(stationSig({ ...base, stops: [makeStop('l1', { row: 1, col: 2, dotSize: 20 })] })).toBe(
      sig,
    );
  });

  it('appends, leaving parts already in the array alone', () => {
    const parts = ['before'];
    pushStationGeomSig(parts, 's1', baseStation());
    expect(parts[0]).toBe('before');
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe('pushLineGeomSig', () => {
  it('moves for the edge set and every dimension that bakes into the paths', () => {
    const base = baseLine();
    const sig = lineSig(base);
    expect(lineSig({ ...base, edges: [...base.edges, 's2|s3'] })).not.toBe(sig);
    expect(lineSig({ ...base, width: 20 })).not.toBe(sig);
    expect(lineSig({ ...base, interlineGap: 4 })).not.toBe(sig);
    expect(lineSig({ ...base, curveRadius: 0 })).not.toBe(sig);
    expect(sigOf((p) => pushLineGeomSig(p, 'l2' as LineId, base))).not.toBe(sig);
  });

  it('holds still for what the routing is blind to — and the routing agrees', () => {
    const base = baseLine();
    const stations = {
      s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('l1')] }),
      s2: makeStation({ id: 's2', x: 100, y: 0, stops: [makeStop('l1')] }),
      s3: makeStation({ id: 's3', x: 100, y: 100, stops: [makeStop('l1')] }),
    };
    const routed = (ln: Line) => JSON.stringify(buildBandGeometry(stations, { l1: ln }));
    const sig = lineSig(base);
    const paths = routed(base);

    // Each of these repaints (colour, casing, end caps, marker footprints, the
    // display order of the member list) without moving one baked path.
    const presentation: Line[] = [
      { ...base, color: '#ff0000' },
      { ...base, strokeWidth: 2 },
      { ...base, endStyle: 'round' },
      { ...base, segmentStyles: { 's1|s2': 'dotted' } },
      { ...base, stationEndStyles: { s1: 'short' } },
      { ...base, stations: ['s2', 's1'] },
      { ...base, name: 'Renamed' },
    ];
    for (const ln of presentation) {
      expect(lineSig(ln)).toBe(sig);
      expect(routed(ln)).toBe(paths);
    }
  });
});

describe('pushLineCircleGeomSig', () => {
  it('moves for the ring a bound edge is routed around, and nothing else', () => {
    const base = makeLineCircle({ id: 'c1', x: 0, y: 0, radius: 80 });
    const sig = circleSig(base);
    expect(circleSig({ ...base, x: 1 })).not.toBe(sig);
    expect(circleSig({ ...base, y: 1 })).not.toBe(sig);
    expect(circleSig({ ...base, radius: 81 })).not.toBe(sig);
    expect(sigOf((p) => pushLineCircleGeomSig(p, 'c2', base))).not.toBe(sig);
    expect(circleSig({ ...base, locked: true })).toBe(sig);
  });
});
