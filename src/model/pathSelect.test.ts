import { describe, it, expect } from 'vitest';
import { pathBetweenStations } from './pathSelect';
import { makeLine } from '../test/fixtures';

const linesIndex = (...ls: ReturnType<typeof makeLine>[]) => {
  const m: Record<string, ReturnType<typeof makeLine>> = {};
  for (const l of ls) m[l.id] = l;
  return m;
};

describe('pathBetweenStations', () => {
  it('returns the half-open slice (from, to] when A is before B on the line', () => {
    const lines = linesIndex(makeLine({ id: 'L1', stations: ['A', 'B', 'C', 'D'] }));
    expect(pathBetweenStations({ lines }, 'A', 'D')).toEqual(['B', 'C', 'D']);
  });

  it('returns the reverse slice when A is after B on the line', () => {
    const lines = linesIndex(makeLine({ id: 'L1', stations: ['A', 'B', 'C', 'D'] }));
    expect(pathBetweenStations({ lines }, 'D', 'A')).toEqual(['C', 'B', 'A']);
  });

  it('picks the shortest path among multiple shared lines', () => {
    // L1: A → X → Y → Z → B (3 intervening); L2: A → B (0 intervening).
    const lines = linesIndex(
      makeLine({ id: 'L1', stations: ['A', 'X', 'Y', 'Z', 'B'] }),
      makeLine({ id: 'L2', stations: ['A', 'B'] }),
    );
    expect(pathBetweenStations({ lines }, 'A', 'B')).toEqual(['B']);
  });

  it('breaks ties by lexicographically lowest lineId', () => {
    // Two lines share A and B with equal-length (2-stop) slices but DIFFERENT
    // intervening stations, registered out of lexical order. The tie-break must
    // pick L1's slice (lowest id), not L2's, and not insertion order.
    const lines = linesIndex(
      makeLine({ id: 'L2', stations: ['A', 'Y', 'B'] }),
      makeLine({ id: 'L1', stations: ['A', 'X', 'B'] }),
    );
    expect(pathBetweenStations({ lines }, 'A', 'B')).toEqual(['X', 'B']);
  });

  it('returns null when no shared line contains both ids', () => {
    const lines = linesIndex(
      makeLine({ id: 'L1', stations: ['A', 'B'] }),
      makeLine({ id: 'L2', stations: ['C', 'D'] }),
    );
    expect(pathBetweenStations({ lines }, 'A', 'D')).toBeNull();
  });

  it('returns null when from === to', () => {
    const lines = linesIndex(makeLine({ id: 'L1', stations: ['A', 'B'] }));
    expect(pathBetweenStations({ lines }, 'A', 'A')).toBeNull();
  });

  it('returns [B] for adjacent A,B', () => {
    const lines = linesIndex(makeLine({ id: 'L1', stations: ['A', 'B'] }));
    expect(pathBetweenStations({ lines }, 'A', 'B')).toEqual(['B']);
  });
});
