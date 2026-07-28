import { describe, expect, it } from 'vitest';
import {
  LINE_END_STYLES,
  endStyleCanRound,
  isLineEndStyle,
  lineEndStyleOf,
  resolveEndStyle,
  stationEndStyleOf,
  withStationEndStyles,
} from './lineEnd';
import { isLineTerminus } from './lineTopology';
import type { Line } from './types';

const line = (patch: Partial<Line> = {}): Line => ({
  id: 'L1',
  service: 'A',
  name: 'A line',
  color: '#ff0000',
  stations: [],
  edges: [],
  ...patch,
});

describe('lineEndStyleOf', () => {
  it('defaults to square when the field is absent', () => {
    expect(lineEndStyleOf(line())).toBe('square');
    expect(lineEndStyleOf(undefined)).toBe('square');
  });

  it('reads the stored value', () => {
    expect(lineEndStyleOf(line({ endStyle: 'round' }))).toBe('round');
  });
});

describe('stationEndStyleOf', () => {
  it('falls back to the line default when the station has no override', () => {
    expect(stationEndStyleOf(line({ endStyle: 'round' }), 'S1')).toBe('round');
  });

  it('prefers the per-station override over the line default', () => {
    const l = line({ endStyle: 'round', stationEndStyles: { S1: 'short' } });
    expect(stationEndStyleOf(l, 'S1')).toBe('short');
    expect(stationEndStyleOf(l, 'S2')).toBe('round');
  });

  it('lets an override pin square against a non-square line default', () => {
    const l = line({ endStyle: 'round', stationEndStyles: { S1: 'square' } });
    expect(stationEndStyleOf(l, 'S1')).toBe('square');
  });
});

describe('endStyleCanRound', () => {
  it('is true only for the styles drawn as a filled shape', () => {
    expect(endStyleCanRound('solid')).toBe(true);
    expect(endStyleCanRound('hatched')).toBe(true);
    expect(endStyleCanRound('hatched-mirror')).toBe(true);
  });

  it('is false for the three dash-pattern strokes', () => {
    expect(endStyleCanRound('dashed')).toBe(false);
    expect(endStyleCanRound('dashed-open')).toBe(false);
    expect(endStyleCanRound('dotted')).toBe(false);
  });
});

describe('resolveEndStyle', () => {
  it('degrades round to short on a dash-pattern style', () => {
    expect(resolveEndStyle('round', 'dashed')).toBe('short');
    expect(resolveEndStyle('round', 'dashed-open')).toBe('short');
    expect(resolveEndStyle('round', 'dotted')).toBe('short');
  });

  it('keeps round on the styles that can paint an arc', () => {
    expect(resolveEndStyle('round', 'solid')).toBe('round');
    expect(resolveEndStyle('round', 'hatched')).toBe('round');
    expect(resolveEndStyle('round', 'hatched-mirror')).toBe('round');
  });

  it('leaves square and short alone on every style', () => {
    for (const style of ['solid', 'dashed', 'hatched', 'dotted', 'dashed-open'] as const) {
      expect(resolveEndStyle('square', style)).toBe('square');
      expect(resolveEndStyle('short', style)).toBe('short');
    }
  });
});

describe('isLineEndStyle', () => {
  it('accepts exactly the three known values', () => {
    for (const v of LINE_END_STYLES) expect(isLineEndStyle(v)).toBe(true);
    expect(LINE_END_STYLES).toEqual(['square', 'short', 'round']);
  });

  it('rejects anything else', () => {
    for (const v of ['Round', 'butt', '', null, undefined, 3, {}]) {
      expect(isLineEndStyle(v)).toBe(false);
    }
  });
});

describe('withStationEndStyles', () => {
  it('replaces the map when pins remain', () => {
    const next = withStationEndStyles(line({ stationEndStyles: { S1: 'round' } }), { S2: 'short' });
    expect(next.stationEndStyles).toEqual({ S2: 'short' });
  });

  it('drops the field entirely once the map empties', () => {
    const next = withStationEndStyles(line({ stationEndStyles: { S1: 'round' } }), {});
    expect('stationEndStyles' in next).toBe(false);
  });

  it('leaves the input line untouched', () => {
    const before = line({ stationEndStyles: { S1: 'round' } });
    withStationEndStyles(before, {});
    expect(before.stationEndStyles).toEqual({ S1: 'round' });
  });
});

describe('isLineTerminus', () => {
  const l = line({ stations: ['A', 'B', 'C'], edges: ['A|B', 'B|C'] });

  it('is true at a degree-1 station', () => {
    expect(isLineTerminus(l, 'A')).toBe(true);
    expect(isLineTerminus(l, 'C')).toBe(true);
  });

  it('is false in the middle of a chain', () => {
    expect(isLineTerminus(l, 'B')).toBe(false);
  });

  it('is false at a junction and on a loop', () => {
    const branched = line({ edges: ['A|B', 'B|C', 'B|D'] });
    expect(isLineTerminus(branched, 'B')).toBe(false);
    const loop = line({ edges: ['A|B', 'B|C', 'A|C'] });
    expect(isLineTerminus(loop, 'A')).toBe(false);
  });

  it('is false for a lone stop with no edges', () => {
    expect(isLineTerminus(line({ stations: ['A'] }), 'A')).toBe(false);
  });
});
