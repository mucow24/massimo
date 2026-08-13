import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { devCounters, makeDevHandle, roundTripDoc } from './devHandle';
import { regionsFor, regionCacheSize, resetRegionCache } from '../geometry/regionCache';
import {
  buildExclusionHolesCached,
  resetExclusionHoleCache,
  type HoleCacheStats,
  type HoleChain,
  type RegionFace,
} from '../geometry/lineRegions';
import { buildRegionsIncremental } from '../geometry/regionIncremental';
import { clearHistory, historyDepth } from '../state/history';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeBandSpec, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId } from '../model/types';

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
  resetExclusionHoleCache();
});

// --- exclusion-hole cache probe --------------------------------------------
// The hole cache has no size accessor; its only observable is that a second,
// identical build REUSES its entries (`stats.reused > 0`) while an empty cache
// RECOMPUTES them. `fillHoleCache` seeds it from a two-crossing grid;
// `reuseFires` reports whether those entries are still warm — the difference is
// how a test sees whether `resetExclusionHoleCache` actually ran.
const hBand = (lineId: string, y: number) =>
  makeBandSpec([lineId], {
    pairKey: `${lineId}|p`,
    bandKey: `${lineId}#b`,
    centerline: [
      { x: -40, y },
      { x: 260, y },
    ],
  });
const vBand = (lineId: string, x: number) =>
  makeBandSpec([lineId], {
    pairKey: `${lineId}|p`,
    bandKey: `${lineId}#b`,
    centerline: [
      { x, y: -40 },
      { x, y: 260 },
    ],
  });
const HOLE_BANDS = [hBand('hA', 0), hBand('hB', 110), vBand('vA', 0), vBand('vB', 110)];
const HOLE_ORDER: LineId[] = ['hA', 'hB', 'vA', 'vB'];

/** Override every multi-cover face to its lowest-ranked cover line, so the
 *  build actually produces hole entries worth caching. */
const overrideAll = (faces: RegionFace[], lineOrder: LineId[]) => {
  const rank = new Map(lineOrder.map((id, i) => [id, i]));
  return faces.map((f) => {
    const sorted = [...f.lineIds].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
    const def = sorted[0];
    const winner = sorted[sorted.length - 1];
    return winner !== def ? { winner, assignmentId: 'r' } : { winner: def, assignmentId: null };
  });
};

const fillHoleCache = () => {
  const built = buildRegionsIncremental(HOLE_BANDS, [], null);
  const winners = overrideAll(built.faces, HOLE_ORDER);
  const chain: HoleChain = { state: built.state, prevState: null, dirtyBoxes: built.dirtyBoxes };
  buildExclusionHolesCached(
    built.faces,
    winners,
    HOLE_ORDER,
    HOLE_BANDS,
    [],
    () => 0,
    built.slivers,
    chain,
  );
  return { built, winners };
};

const reuseFires = (
  built: ReturnType<typeof buildRegionsIncremental>,
  winners: ReturnType<typeof overrideAll>,
): boolean => {
  const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
  const sameState: HoleChain = { state: built.state, prevState: null, dirtyBoxes: [] };
  buildExclusionHolesCached(
    built.faces,
    winners,
    HOLE_ORDER,
    HOLE_BANDS,
    [],
    () => 0,
    built.slivers,
    sameState,
    stats,
  );
  return stats.reused > 0;
};

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
  it('stores hands out the app singletons, and a selection driven through it is live', () => {
    const h = makeDevHandle();
    // Identity, not shape: the entire value of the door is that e2e drives the
    // SAME instances the React tree renders from — a copy would select nothing.
    expect(h.stores.doc).toBe(useDoc);
    expect(h.stores.selection).toBe(useSelection);
    h.stores.selection.getState().selectStation('s1');
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
    h.stores.selection.getState().selectStation(null);
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  it('reset.history empties the undo stack', () => {
    useDoc.getState().addStation(50, 50, 'New');
    expect(historyDepth()).toBeGreaterThan(0);
    makeDevHandle().reset.history();
    expect(historyDepth()).toBe(0);
  });

  it('reset.regions empties both the region LRU and the exclusion-hole cache', () => {
    regionsFor({
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineCircles: {},
    });
    const { built, winners } = fillHoleCache();
    expect(regionCacheSize()).toBeGreaterThan(0);
    expect(reuseFires(built, winners)).toBe(true); // both caches warm

    makeDevHandle().reset.regions();

    // Both caches, not just the region LRU — dropping the hole-cache reset
    // would leave stale exclusion geometry behind and this would catch it.
    expect(regionCacheSize()).toBe(0);
    expect(reuseFires(built, winners)).toBe(false);
  });

  it('reset.all drops history, both region caches, and re-parses the doc', () => {
    useDoc.getState().addStation(50, 50, 'New');
    regionsFor({
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineCircles: {},
    });
    const { built, winners } = fillHoleCache();
    expect(historyDepth()).toBeGreaterThan(0);
    expect(regionCacheSize()).toBeGreaterThan(0);
    expect(reuseFires(built, winners)).toBe(true);
    const beforeStations = useDoc.getState().stations;

    makeDevHandle().reset.all();

    // Each of the four things a reload resets; a fan-out that dropped any one
    // of them would leave its assertion standing.
    expect(historyDepth()).toBe(0);
    expect(regionCacheSize()).toBe(0);
    expect(reuseFires(built, winners)).toBe(false);
    expect(useDoc.getState().stations).not.toBe(beforeStations); // doc re-parsed in place
  });
});

afterEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  resetRegionCache();
  resetExclusionHoleCache();
});
