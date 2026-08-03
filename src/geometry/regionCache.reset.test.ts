import { describe, it, expect, beforeEach } from 'vitest';
import { regionsFor, resetRegionCache, type GeometrySlice } from './regionCache';
import { makeLine, makeStation, makeStop } from '../test/fixtures';

/** Two crossing corridors — enough to produce a real overlap arrangement. */
const geom = (y: number): GeometrySlice => ({
  stations: {
    s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] }),
    s2: makeStation({ id: 's2', x: 200, y: 0, stops: [makeStop('L1')] }),
    s3: makeStation({ id: 's3', x: 100, y: y - 100, stops: [makeStop('L2')] }),
    s4: makeStation({ id: 's4', x: 100, y: y + 100, stops: [makeStop('L2')] }),
  },
  lines: {
    L1: makeLine({ id: 'L1', stations: ['s1', 's2'], width: 14 }),
    L2: makeLine({ id: 'L2', stations: ['s3', 's4'], width: 14 }),
  },
  lineCircles: {},
});

describe('resetRegionCache', () => {
  beforeEach(() => resetRegionCache());

  it('BASELINE: without a reset, a repeat call is served from the LRU', () => {
    const g = geom(0);
    expect(regionsFor(g)).toBe(regionsFor(g));
  });

  it('forgets the LRU, so the next identical call rebuilds instead of hitting', () => {
    const g = geom(0);
    const first = regionsFor(g);
    resetRegionCache();
    expect(regionsFor(g)).not.toBe(first);
  });

  it('forgets the incremental seed, so the next build starts cold', () => {
    regionsFor(geom(0));
    resetRegionCache();
    // A build carrying a seed records it as holeChain.prevState; a cold one
    // has nothing to chain from.
    expect(regionsFor(geom(30)).holeChain.prevState).toBeNull();
  });

  it('leaves the geometry it rebuilds identical to what the cache was serving', () => {
    const g = geom(0);
    const before = regionsFor(g);
    resetRegionCache();
    const after = regionsFor(g);
    expect(after.faces.length).toBe(before.faces.length);
    expect(after.faces.map((f) => f.face)).toEqual(before.faces.map((f) => f.face));
  });
});
