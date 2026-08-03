import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { devCounters, makeDevHandle, roundTripDoc } from './devHandle';
import { regionsFor, regionCacheSize, resetRegionCache } from '../geometry/regionCache';
import { clearHistory, historyDepth } from '../state/history';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';

const seedDoc = () =>
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: {
      s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] }),
      s2: makeStation({ id: 's2', x: 200, y: 0, stops: [makeStop('L1')] }),
    },
    lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'], width: 14 }) },
  });

beforeEach(() => {
  seedDoc();
  clearHistory();
  resetRegionCache();
});

describe('devCounters', () => {
  it('reports the live doc size', () => {
    const c = devCounters();
    expect(c.stations).toBe(2);
    expect(c.lines).toBe(1);
    expect(c.regionAssignments).toBe(0);
  });

  it('tracks the undo stack as edits land', () => {
    expect(devCounters().past).toBe(0);
    useDoc.getState().addStation(50, 50, 'New');
    expect(devCounters().past).toBe(historyDepth());
    expect(devCounters().past).toBeGreaterThan(0);
  });

  it('tracks the region cache filling and emptying', () => {
    const g = {
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineCircles: {},
    };
    regionsFor(g);
    expect(devCounters().regionCache).toBe(regionCacheSize());
    expect(devCounters().regionCache).toBeGreaterThan(0);
    resetRegionCache();
    expect(devCounters().regionCache).toBe(0);
  });

  it('counts zero painted nodes when no canvas is mounted, rather than throwing', () => {
    const c = devCounters();
    expect(c.svgNodes).toBe(0);
    expect(c.clipPaths).toBe(0);
  });
});

describe('roundTripDoc', () => {
  it('replaces the doc with re-parsed records, not the ones already in the store', () => {
    const before = useDoc.getState();
    expect(roundTripDoc()).toBe(true);
    const after = useDoc.getState();
    // The point of the round-trip is that the store ends up holding what the
    // LOAD PATH produces. Value-equality alone would pass if the write never
    // happened at all, so pin the fresh identity too.
    expect(after.stations).not.toBe(before.stations);
    expect(after.stations.s1).not.toBe(before.stations.s1);
  });

  it('preserves the document through serialize -> parse', () => {
    const before = useDoc.getState();
    expect(roundTripDoc()).toBe(true);
    const after = useDoc.getState();
    expect(Object.keys(after.stations)).toEqual(Object.keys(before.stations));
    expect(Object.keys(after.lines)).toEqual(Object.keys(before.lines));
    expect(after.stations.s1.x).toBe(before.stations.s1.x);
    expect(after.lines.L1.edges).toEqual(before.lines.L1.edges);
  });

  it('reports failure instead of throwing when the doc is too malformed to parse', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = useDoc.getState().stations;
    // `parse` is not total: sanitizeStations walks `stations` unguarded, so a
    // doc this broken throws rather than returning { ok: false }. A helper run
    // while diagnosing a slow session must survive that.
    useDoc.setState({ ...useDoc.getState(), stations: null as never });
    expect(() => roundTripDoc()).not.toThrow();
    expect(roundTripDoc()).toBe(false);
    expect(useDoc.getState().stations).toBe(null);
    useDoc.setState({ ...useDoc.getState(), stations: before });
    spy.mockRestore();
  });
});

describe('the handle wiring', () => {
  it('reset.history empties the undo stack', () => {
    useDoc.getState().addStation(50, 50, 'New');
    expect(historyDepth()).toBeGreaterThan(0);
    makeDevHandle().reset.history();
    expect(historyDepth()).toBe(0);
  });

  it('reset.regions empties the region cache', () => {
    regionsFor({
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineCircles: {},
    });
    expect(regionCacheSize()).toBeGreaterThan(0);
    makeDevHandle().reset.regions();
    expect(regionCacheSize()).toBe(0);
  });
});

afterEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  resetRegionCache();
});
