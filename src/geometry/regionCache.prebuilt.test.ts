import { describe, it, expect } from 'vitest';
import { regionsFor, type GeometrySlice } from '../geometry/regionCache';
import { buildBandGeometry, buildStopMarkers } from '../geometry/interlining';
import { buildOverlapRegions } from '../geometry/lineRegions';
import { makeLine, makeStation, makeStop } from '../test/fixtures';

/**
 * regionsFor's prebuilt fast path: the render layer already built this frame's
 * bands + markers in its own memos, so regionsFor must not build them again.
 * A crossing of two lines, offset into its own coordinate neighborhood so its
 * sig can't collide with other test files' cached entries.
 */
const crossing = (dx = 0): GeometrySlice => ({
  stations: {
    w: makeStation({ id: 'w', x: dx - 100, y: 1000, stops: [makeStop('H')] }),
    e: makeStation({ id: 'e', x: dx + 100, y: 1000, stops: [makeStop('H')] }),
    n: makeStation({ id: 'n', x: dx, y: 900, stops: [makeStop('V')] }),
    s: makeStation({ id: 's', x: dx, y: 1100, stops: [makeStop('V')] }),
  },
  lines: {
    H: makeLine({ id: 'H', stations: ['w', 'e'], width: 14 }),
    V: makeLine({ id: 'V', stations: ['n', 's'], width: 14 }),
  },
  lineCircles: {},
});

const prebuiltFor = (g: GeometrySlice, lineOrder: string[] = []) => {
  const bands = buildBandGeometry(g.stations, g.lines);
  const markers = buildStopMarkers(g.stations, g.lines, lineOrder, bands);
  return { bands, markers };
};

describe('regionsFor prebuilt geometry', () => {
  it('adopts the prebuilt bands and markers instead of rebuilding them', () => {
    const g = crossing(0);
    const prebuilt = prebuiltFor(g);
    const entry = regionsFor(g, prebuilt);
    expect(entry.bands).toBe(prebuilt.bands);
    expect(entry.markers).toBe(prebuilt.markers);
  });

  it('produces faces identical to the uncached reference', () => {
    const g = crossing(1000);
    const prebuilt = prebuiltFor(g);
    const entry = regionsFor(g, prebuilt);
    const truth = buildOverlapRegions(prebuilt.bands, prebuilt.markers, []);
    expect(entry.faces).toHaveLength(truth.length);
    expect(entry.faces[0].lineIds).toEqual(truth[0].lineIds);
    expect(entry.faces[0].area).toBeCloseTo(truth[0].area, 5);
  });

  it('serves the prebuilt-created entry to later callers without prebuilt', () => {
    const g = crossing(2000);
    const prebuilt = prebuiltFor(g);
    const first = regionsFor(g, prebuilt);
    const second = regionsFor({ ...g });
    expect(second).toBe(first);
  });

  it('priority-stamped markers (render-side lineOrder) yield the same faces as priority-free ones', () => {
    // The render layer builds markers with the real lineOrder (priorities
    // stamped); regionsFor's own build uses [] — region geometry must be
    // blind to the difference for the shared cache to be sound.
    const gA = crossing(3000);
    const gB = crossing(4000);
    const withPriorities = regionsFor(gA, prebuiltFor(gA, ['V', 'H']));
    const without = regionsFor(gB, prebuiltFor(gB, []));
    expect(withPriorities.faces).toHaveLength(without.faces.length);
    expect(withPriorities.faces[0].area).toBeCloseTo(without.faces[0].area, 5);
    expect(withPriorities.faces[0].lineIds).toEqual(without.faces[0].lineIds);
  });
});
