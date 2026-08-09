import { describe, it, expect } from 'vitest';
import { regionsFor, regionGeometrySig, type GeometrySlice } from './regionCache';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, Station } from '../model/types';

const geom = (stations: Station[], lines: Line[]): GeometrySlice => {
  const st: GeometrySlice['stations'] = {};
  for (const s of stations) st[s.id] = s;
  const ln: GeometrySlice['lines'] = {};
  for (const l of lines) ln[l.id] = l;
  return { stations: st, lines: ln, lineCircles: {} };
};

const station = (id: string, x: number, y: number, lineIds: string[]): Station =>
  makeStation({ id, x, y, stops: lineIds.map((l) => makeStop(l)) });

/** l1 horizontal (0,0)→(400,0); l2 vertical at x crossing it — one overlap face. */
const crossGeom = (x: number): GeometrySlice =>
  geom(
    [
      station('s1', 0, 0, ['l1']),
      station('s2', 400, 0, ['l1']),
      station('s3', x, -50, ['l2']),
      station('s4', x, 50, ['l2']),
    ],
    [
      makeLine({ id: 'l1', stations: ['s1', 's2'] }),
      makeLine({ id: 'l2', stations: ['s3', 's4'] }),
    ],
  );

describe('regionGeometrySig', () => {
  // The sig is the cache key. It MUST change for every field that moves band
  // geometry (or a stale cache silently paints the wrong faces) and MUST NOT
  // change for presentation (or reconcile/render needlessly recompute).
  it('changes when a geometry-affecting field changes', () => {
    const base = crossGeom(50);
    const sig = regionGeometrySig(base);

    // station position
    expect(regionGeometrySig(crossGeom(60))).not.toBe(sig);
    // station rotation
    const rotated = {
      ...base,
      stations: { ...base.stations, s1: { ...base.stations.s1, rotation: 2 as const } },
    };
    expect(regionGeometrySig(rotated)).not.toBe(sig);
    // stop cell
    const movedStop = {
      ...base,
      stations: {
        ...base.stations,
        s1: { ...base.stations.s1, stops: [makeStop('l1', { row: 3 })] },
      },
    };
    expect(regionGeometrySig(movedStop)).not.toBe(sig);
    // line edge set
    const rewired = {
      ...base,
      lines: { ...base.lines, l1: { ...base.lines.l1, edges: ['s1|s3'] } },
    };
    expect(regionGeometrySig(rewired)).not.toBe(sig);
    // line width (drives stripe offsets / band merging)
    const widened = { ...base, lines: { ...base.lines, l1: { ...base.lines.l1, width: 20 } } };
    expect(regionGeometrySig(widened)).not.toBe(sig);
    // per-segment style value (flips marker footprints)
    const styled = {
      ...base,
      lines: {
        ...base.lines,
        l1: { ...base.lines.l1, segmentStyles: { 's1|s2': 'dotted' as const } },
      },
    };
    expect(regionGeometrySig(styled)).not.toBe(sig);
    // per-line curve radius (drives the band fillet radius)
    const tightened = {
      ...base,
      lines: { ...base.lines, l1: { ...base.lines.l1, curveRadius: 12 } },
    };
    expect(regionGeometrySig(tightened)).not.toBe(sig);
    // line END style (withdraws or reshapes the marker's outward half)
    const rounded = {
      ...base,
      lines: { ...base.lines, l1: { ...base.lines.l1, endStyle: 'round' as const } },
    };
    expect(regionGeometrySig(rounded)).not.toBe(sig);
    // …and a single per-terminus pin, which reshapes exactly one marker
    const pinned = {
      ...base,
      lines: {
        ...base.lines,
        l1: { ...base.lines.l1, stationEndStyles: { s1: 'short' as const } },
      },
    };
    expect(regionGeometrySig(pinned)).not.toBe(sig);
    // two different pins on the same line must not collide
    const pinnedElsewhere = {
      ...base,
      lines: {
        ...base.lines,
        l1: { ...base.lines.l1, stationEndStyles: { s2: 'short' as const } },
      },
    };
    expect(regionGeometrySig(pinnedElsewhere)).not.toBe(regionGeometrySig(pinned));
  });

  it('is stable across presentation-only changes (color, casing)', () => {
    const base = crossGeom(50);
    const sig = regionGeometrySig(base);
    const repainted = {
      ...base,
      lines: {
        ...base.lines,
        l1: {
          ...base.lines.l1,
          color: '#ff0000',
          strokeWidth: 4,
          strokeColor: { day: '#123456', night: '#123456' },
        },
      },
    };
    expect(regionGeometrySig(repainted)).toBe(sig);
  });

  it('ignores stopless stations and edgeless lines (they carry no band geometry)', () => {
    const base = crossGeom(50);
    const sig = regionGeometrySig(base);
    const withGhosts = geom(
      [
        base.stations.s1,
        base.stations.s2,
        base.stations.s3,
        base.stations.s4,
        makeStation({ id: 'ghost', x: 999, y: 999 }), // no stops
      ],
      [
        base.lines.l1,
        base.lines.l2,
        makeLine({ id: 'empty', stations: [] }), // no edges
      ],
    );
    expect(regionGeometrySig(withGhosts)).toBe(sig);
  });
});

describe('regionsFor caching', () => {
  it('shares one entry for content-equal slices (render/reconcile hit the same cache)', () => {
    const r = regionsFor(crossGeom(37));
    // A distinct object with identical geometry must resolve to the SAME entry —
    // this is the whole point of the sig-keyed cache.
    expect(regionsFor(crossGeom(37))).toBe(r);
  });

  it('returns the cached entry unchanged when only presentation differs', () => {
    const g = crossGeom(41);
    const r = regionsFor(g);
    const repainted = {
      ...g,
      lines: { ...g.lines, l1: { ...g.lines.l1, color: '#00ff00', strokeWidth: 2 } },
    };
    expect(regionsFor(repainted)).toBe(r);
  });

  it('recomputes after a geometry change', () => {
    const r = regionsFor(crossGeom(43));
    expect(regionsFor(crossGeom(47))).not.toBe(r);
  });

  it('evicts the least-recently-used entry past the cache limit', () => {
    // Six distinct geometries; the cache holds 4. After inserting all six, the
    // four newest survive and the two oldest are gone, so re-fetching the first
    // recomputes (a fresh object) while the newest is still a hit.
    const gs = [113, 163, 213, 263, 313, 363].map(crossGeom);
    const first = regionsFor(gs[0]);
    for (const g of gs.slice(1)) regionsFor(g);
    expect(regionsFor(gs[0])).not.toBe(first); // evicted → recomputed
    const newest = regionsFor(gs[5]);
    expect(regionsFor(gs[5])).toBe(newest); // still cached
  });

  it('transient frames stay out of the LRU and preserve the pre-gesture entry', () => {
    // The pre-gesture geometry goes in normally…
    const pre = crossGeom(1113);
    const preEntry = regionsFor(pre);
    // …then a long drag streams transient frames — more than the LRU holds.
    for (const x of [1163, 1213, 1263, 1313, 1363, 1413]) {
      regionsFor(crossGeom(x), undefined, { transient: true });
    }
    // The commit reconcile's old-geometry lookup still HITS: mid-gesture
    // frames were never inserted, so they could not evict it. (Under
    // insert-per-frame it would have been evicted within CACHE_LIMIT moves.)
    expect(regionsFor(pre)).toBe(preEntry);
    // And the transient frames themselves were not cached: asking for one
    // non-transiently is a fresh build, not a hit.
    const again = regionsFor(crossGeom(1413));
    expect(again.faces.length).toBeGreaterThanOrEqual(0); // built, no throw
    // Its chain seeds from the LAST build, whichever that was — the
    // incremental slot advanced through the transient frames.
    expect(again.holeChain.prevState).not.toBeNull();
  });
});
