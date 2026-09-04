import { describe, it, expect } from 'vitest';
import { stationsOnCircles } from './lineCircle';
import { makeStation } from '../test/fixtures';

// Two rings with a passenger each, plus a locked passenger and a free station.
// Lock and selection are deliberately absent from the rule: `moveLineCircle`
// carries every passenger either way, so a gesture that also WROTE one would
// slide it round a rim that has already moved.
const stations = {
  a1: makeStation({ id: 'a1', circleId: 'c1' }),
  a2: makeStation({ id: 'a2', circleId: 'c1', locked: true }),
  b1: makeStation({ id: 'b1', circleId: 'c2' }),
  free: makeStation({ id: 'free' }),
};

describe('stationsOnCircles — the stations a moving ring carries', () => {
  it('collects every station bound to a named ring, locked ones included', () => {
    expect(stationsOnCircles(stations, ['c1'])).toEqual(new Set(['a1', 'a2']));
  });

  it('unions across several rings', () => {
    expect(stationsOnCircles(stations, ['c1', 'c2'])).toEqual(new Set(['a1', 'a2', 'b1']));
  });

  it('leaves unbound stations and passengers of OTHER rings out', () => {
    expect(stationsOnCircles(stations, ['c2'])).toEqual(new Set(['b1']));
  });

  it('is empty for no rings, and for a ring nothing is bound to', () => {
    expect(stationsOnCircles(stations, [])).toEqual(new Set());
    expect(stationsOnCircles(stations, ['c9'])).toEqual(new Set());
  });

  it('takes any iterable of ids — the drag half holds its moving rings as a Set', () => {
    expect(stationsOnCircles(stations, new Set(['c1']))).toEqual(new Set(['a1', 'a2']));
  });
});
