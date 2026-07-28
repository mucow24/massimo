import { describe, expect, it } from 'vitest';
import { buildOverlapRegions, ringsBbox, type RegionFace, type RegionSliver } from './lineRegions';
import {
  buildRegionsIncremental,
  compCacheKey,
  type RegionIncrementalResult,
  type RegionIncrementalState,
} from './regionIncremental';
import { makeBandSpec } from '../test/fixtures';
import type { SegmentBandSpec, StopMarkerSpec } from './interlining';
import type { LineEndStyle } from '../model/types';
import type { Ring } from './clip';

/**
 * A grid of three horizontal and three vertical lines: nine well-separated
 * crossings, so the arrangement has several independent components and moving
 * one line can only touch the ones it passes through.
 */
const hBand = (lineId: string, y: number): SegmentBandSpec =>
  makeBandSpec([lineId], {
    pairKey: `h${y}|h${y}b`,
    bandKey: `h${lineId}@${y}`,
    centerline: [
      { x: -40, y },
      { x: 260, y },
    ],
  });

const vBand = (lineId: string, x: number): SegmentBandSpec =>
  makeBandSpec([lineId], {
    pairKey: `v${x}|v${x}b`,
    bandKey: `v${lineId}@${x}`,
    centerline: [
      { x, y: -40 },
      { x, y: 260 },
    ],
  });

/** The grid, with vertical line `vB` shifted by `dx` (0 = the base layout). */
const grid = (dx = 0): SegmentBandSpec[] => [
  hBand('hA', 0),
  hBand('hB', 110),
  hBand('hC', 220),
  vBand('vA', 0),
  vBand('vB', 110 + dx),
  vBand('vC', 220),
];

/**
 * Faces described by cover + geometry + SPANS, order-independent.
 *
 * Spans belong in here rather than in a test of their own: they are the part of
 * a face that survives reuse untouched while the geometry that defines them
 * moves, so a comparison that omits them cannot see the one thing incremental
 * rebuilding is most likely to get wrong.
 */
const describeFaces = (faces: RegionFace[]): string =>
  faces
    .map(
      (f) =>
        `${f.lineIds.join(',')}#${f.area.toFixed(4)}#` +
        f.face.map((r) => r.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')).join('|') +
        '#' +
        [...f.spans.entries()]
          .map(
            ([k, e]) =>
              `${k}=${e.totalLen.toFixed(3)}[` +
              e.intervals.map((i) => `${i.d0.toFixed(3)}..${i.d1.toFixed(3)}`).join(' ') +
              ']',
          )
          .sort()
          .join(','),
    )
    .sort()
    .join('\n');

/** Dropped slivers described by cover + geometry, order-independent. */
const describeSlivers = (slivers: RegionSliver[]): string =>
  slivers
    .map(
      (s) =>
        `${s.lineIds.join(',')}#` +
        s.face.map((r) => r.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')).join('|'),
    )
    .sort()
    .join('\n');

/** Cold build — faces AND dropped slivers, the answer any frame must match. */
const fullBuild = (bands: SegmentBandSpec[]): { faces: string; slivers: string } => {
  const sink: RegionSliver[] = [];
  const faces = buildOverlapRegions(bands, [], sink);
  return { faces: describeFaces(faces), slivers: describeSlivers(sink) };
};

/**
 * Slivers are compared alongside faces because they are not debris:
 * `buildExclusionHoles` absorbs them to keep a winner's revealed casing
 * continuous across a fillet gap. A component served from the cache has to hand
 * its slivers back as faithfully as its faces, and the faces alone cannot see it.
 */
const expectEqualsFull = (inc: RegionIncrementalResult, bands: SegmentBandSpec[]): void => {
  const ref = fullBuild(bands);
  expect(describeFaces(inc.faces)).toBe(ref.faces);
  expect(describeSlivers(inc.slivers)).toBe(ref.slivers);
};

/** Cold build including markers — faces only, for the marker-end test. */
const fullWith = (bands: SegmentBandSpec[], markers: StopMarkerSpec[]) =>
  describeFaces(buildOverlapRegions(bands, markers, []));

/**
 * A line with INTERIOR centerline vertices, so moving one end localizes the
 * dirty box to that end and leaves the crossings further along reusable. The
 * grid above cannot express this — its bands are two points, so any move
 * dirties their whole length and every face gets rebuilt.
 */
const stubbed = (x0: number): SegmentBandSpec =>
  makeBandSpec(['hA'], {
    pairKey: 'hA|hAb',
    bandKey: 'b-hA',
    centerline: [
      { x: x0, y: 0 },
      { x: -20, y: 0 },
      { x: 240, y: 0 },
      { x: 260, y: 0 },
    ],
  });

const crossing = (lineId: string, x: number, dx = 0): SegmentBandSpec =>
  makeBandSpec([lineId], {
    pairKey: `${lineId}|${lineId}b`,
    bandKey: `b-${lineId}`,
    centerline: [
      { x: x + dx, y: -40 },
      { x: x + dx, y: 260 },
    ],
  });

/** `hA` starting at `hStart`, crossed by three verticals; `vA` shifted by `vAdx`. */
const stubbedGrid = (hStart: number, vAdx: number): SegmentBandSpec[] => [
  stubbed(hStart),
  crossing('vA', 0, vAdx),
  crossing('vB', 110),
  crossing('vC', 220),
];

/**
 * Three bands far enough apart that no two bodies touch, so the overlap zone is
 * empty on every frame. Line `c` shifts by `dx`.
 */
const apart = (dx = 0): SegmentBandSpec[] => [
  makeBandSpec(['a'], {
    pairKey: 'a1|a2',
    bandKey: 'b-a',
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }),
  makeBandSpec(['b'], {
    pairKey: 'b1|b2',
    bandKey: 'b-b',
    centerline: [
      { x: 0, y: 200 },
      { x: 100, y: 200 },
    ],
  }),
  makeBandSpec(['c'], {
    pairKey: 'c1|c2',
    bandKey: 'b-c',
    centerline: [
      { x: dx, y: 400 },
      { x: 100 + dx, y: 400 },
    ],
  }),
];

/**
 * A near-tangent dumbbell: `l2` crosses `l1` twice and runs 0.1 INSIDE it in
 * between (stripes are 14 wide, so a 13.9 offset leaves a 0.1 overlap), and the
 * opening splits that hairline neck off and drops it as a SLIVER. Plus a plain
 * crossing far to the right by `l3` — the only thing `dx` moves, so the
 * dumbbell's component is reused across a drag while `l3`'s is rebuilt.
 *
 * The grid fixtures above drop no slivers at all, which would make any sliver
 * comparison over them a comparison of two empty lists.
 */
const dumbbell = (dx = 0): SegmentBandSpec[] => [
  makeBandSpec(['l1'], {
    pairKey: 'd0|d1',
    bandKey: 'd-l1',
    centerline: [
      { x: 0, y: 0 },
      { x: 700, y: 0 },
    ],
  }),
  makeBandSpec(['l2'], {
    pairKey: 'd2|d3',
    bandKey: 'd-l2-in',
    centerline: [
      { x: 100, y: -50 },
      { x: 100, y: 13.9 },
    ],
  }),
  makeBandSpec(['l2'], {
    pairKey: 'd3|d4',
    bandKey: 'd-l2-neck',
    centerline: [
      { x: 100, y: 13.9 },
      { x: 300, y: 13.9 },
    ],
  }),
  makeBandSpec(['l2'], {
    pairKey: 'd4|d5',
    bandKey: 'd-l2-out',
    centerline: [
      { x: 300, y: 13.9 },
      { x: 300, y: -50 },
    ],
  }),
  makeBandSpec(['l3'], {
    pairKey: 'd6|d7',
    bandKey: 'd-l3',
    centerline: [
      { x: 600 + dx, y: -50 },
      { x: 600 + dx, y: 50 },
    ],
  }),
];

/** One two-line band, varying ONLY which line takes which stripe slot. */
const shared = (order: string[]): SegmentBandSpec[] => [
  makeBandSpec(order, {
    pairKey: 'ab|abb',
    // Permutation-stable by construction: bandKey is built from sorted ids.
    bandKey: 's1|s2#A,B',
    centerline: [
      { x: -50, y: 0 },
      { x: 250, y: 0 },
    ],
  }),
  crossing('C', 100),
];

describe('buildRegionsIncremental', () => {
  it('a cold build equals a full build', () => {
    const bands = grid();
    const r = buildRegionsIncremental(bands, [], null);
    expect(r.faces.length).toBeGreaterThan(0);
    expectEqualsFull(r, bands);
  });

  it('equals a full build after each step of a drag', () => {
    let state: RegionIncrementalState | null = buildRegionsIncremental(grid(), [], null).state;
    for (const dx of [3, 6, 9, 12]) {
      const bands = grid(dx);
      const inc = buildRegionsIncremental(bands, [], state);
      expectEqualsFull(inc, bands);
      state = inc.state;
    }
  });

  it('equals a full build when a line is removed entirely', () => {
    const state = buildRegionsIncremental(grid(), [], null).state;
    const fewer = grid().filter((b) => b.lines[0].id !== 'vB');
    const inc = buildRegionsIncremental(fewer, [], state);
    expectEqualsFull(inc, fewer);
  });

  // The grid never produces a sliver, so every equivalence above compares two
  // empty sliver lists. This fixture drops one on every frame, and drags a line
  // that is nowhere near it — so the dumbbell's component is served from cache
  // and has to hand its slivers back exactly as a cold build computes them.
  it('equals a full build — slivers included — across a near-tangent drag', () => {
    const cold = buildRegionsIncremental(dumbbell(), [], null);
    // Non-vacuity guard: without a dropped sliver this test proves nothing.
    expect(fullBuild(dumbbell()).slivers).not.toBe('');
    expectEqualsFull(cold, dumbbell());

    let state = cold.state;
    for (const dx of [3, 6, 9]) {
      const bands = dumbbell(dx);
      const inc = buildRegionsIncremental(bands, [], state);
      // Both paths are live: l3's crossing rebuilds, the dumbbell is reused.
      expect(inc.rebuilt).toBeGreaterThan(0);
      expect(inc.rebuilt).toBeLessThan(inc.total);
      expectEqualsFull(inc, bands);
      state = inc.state;
    }
  });

  // Removing a line leaves every SURVIVING pair clean, so the zone fast-path
  // would happily return the previous frame's zone — which still contains the
  // dead line's overlap territory. Faces come out right either way (downstream
  // drops single-cover cells), but the phantom territory lingers as zombie
  // components that are pointlessly rebuilt and cached. Component count is the
  // observable: it must match a cold build's.
  it('drops a removed line’s overlap territory from the zone', () => {
    const state = buildRegionsIncremental(grid(), [], null).state;
    const fewer = grid().filter((b) => b.lines[0].id !== 'vB');
    const inc = buildRegionsIncremental(fewer, [], state);
    expect(inc.total).toBe(buildRegionsIncremental(fewer, [], null).total);
  });

  // Without these, every equivalence test above would still pass on an
  // implementation that rebuilt everything on every frame.
  it('reuses every component when nothing moves', () => {
    const bands = grid();
    const state = buildRegionsIncremental(bands, [], null).state;
    const again = buildRegionsIncremental(grid(), [], state);
    expect(again.total).toBeGreaterThan(1);
    expect(again.rebuilt).toBe(0);
    expect(again.reused).toBe(true);
  });

  it('rebuilds only the components the moved line passes through', () => {
    const state = buildRegionsIncremental(grid(), [], null).state;
    const inc = buildRegionsIncremental(grid(6), [], state);
    // vB crosses three of the nine crossings, so most components must survive.
    expect(inc.total).toBeGreaterThanOrEqual(9);
    expect(inc.rebuilt).toBeGreaterThan(0);
    expect(inc.rebuilt).toBeLessThan(inc.total / 2);
  });

  // Spans are arc lengths from each stripe's START, so they go stale on a face
  // whose polygon never moves. The refresh must survive being carried through a
  // frame that does NOT touch the covering line, which means it has to reach
  // the cache and not just the copy handed out.
  it('keeps span arc-lengths correct when the next frame moves a different line', () => {
    const s0 = buildRegionsIncremental(stubbedGrid(-40, 0), [], null).state;
    // Frame 1: hA's start slides, so every crossing's arc length shifts while
    // the crossings themselves sit far outside the dirty box and are reused.
    const s1 = buildRegionsIncremental(stubbedGrid(-60, 0), [], s0).state;
    // Frame 2: an unrelated line moves. hA is clean now — but it moved since
    // those components were last built.
    const inc = buildRegionsIncremental(stubbedGrid(-60, 3), [], s1);
    expect(inc.rebuilt).toBeLessThan(inc.total); // reuse really is in play
    expectEqualsFull(inc, stubbedGrid(-60, 3));
  });

  // Two lines swapping stripe slots leaves every stripe's geometry byte-identical
  // and the band key untouched, so nothing about the SHAPE of the frame changed —
  // only which line owns which side.
  it('notices two lines swapping stripe slots within a band', () => {
    const state = buildRegionsIncremental(shared(['A', 'B']), [], null).state;
    const inc = buildRegionsIncremental(shared(['B', 'A']), [], state);
    expectEqualsFull(inc, shared(['B', 'A']));
  });

  // A marker's LINE END reshapes its painted footprint (markerBodyRings), so it
  // has to reach the unit hash. It is the one marker field with no other
  // observable effect on the spec — cx/cy/rotationDeg/width/style/outward all
  // stay put when only the end changes — so if it is missing from the hash the
  // line never goes dirty and the PREVIOUS frame's square-footprint body is
  // reused, silently, under a cache key that says it is current.
  it('rebuilds when only a marker’s line END changes', () => {
    // hA ENDS at x=250 and vB runs at x=257, clear of it — so the only thing
    // that can overlap vB is the marker's OUTWARD half. A square end reaches
    // x=257 and crosses; a short end stops dead at 250 and cannot. That makes
    // the end style the sole determinant of whether a face exists at all.
    const marker = (end: LineEndStyle): StopMarkerSpec => ({
      cx: 250,
      cy: 0,
      color: '#000000',
      lineId: 'hA',
      stationId: 'sEnd',
      rotationDeg: 0,
      priority: 0,
      style: 'solid',
      end,
      outward: { x: 1, y: 0 },
      width: 14,
    });
    const bands = [
      makeBandSpec(['hA'], {
        pairKey: 'hA|hAb',
        bandKey: 'hA@end',
        centerline: [
          { x: -40, y: 0 },
          { x: 250, y: 0 },
        ],
      }),
      makeBandSpec(['vB'], {
        pairKey: 'vB|vBb',
        bandKey: 'vB@257',
        centerline: [
          { x: 257, y: -40 },
          { x: 257, y: 260 },
        ],
      }),
    ];

    // The two ends really do differ cold — otherwise this test is vacuous.
    const coldSquare = fullWith(bands, [marker('square')]);
    const coldShort = fullWith(bands, [marker('short')]);
    expect(coldSquare).not.toBe(coldShort);
    expect(coldSquare).toContain('hA,vB'); // the square end crosses vB
    expect(coldShort).toBe(''); // the short end never reaches it

    const state = buildRegionsIncremental(bands, [marker('square')], null).state;
    const inc = buildRegionsIncremental(bands, [marker('short')], state);
    expect(describeFaces(inc.faces)).toBe(coldShort);
  });

  // An overlap-free frame is not an idle one: a document with dormant
  // `regionAssignments` runs this builder on every pointermove, and a map whose
  // lines happen not to cross yet takes the empty-zone early-out on all of
  // them. Throwing the prefix away there made the NEXT frame re-offset every
  // stripe and re-intersect every pair from scratch — the priciest half of the
  // build, discarded because the cheap half came out empty.
  it('carries bodies and pair intersections through an overlap-free frame', () => {
    const f1 = buildRegionsIncremental(apart(), [], null);
    expect(f1.faces).toHaveLength(0);
    expect(f1.state.bodies.size).toBe(3);
    expect(f1.state.pairParts.size).toBe(3); // a|b, a|c, b|c — the zone path ran

    // Nothing moved: every body and every pair intersection comes back as the
    // SAME object, which is what reuse looks like from outside.
    const f2 = buildRegionsIncremental(apart(), [], f1.state);
    for (const id of ['a', 'b', 'c']) {
      expect(f2.state.bodies.get(id)).toBe(f1.state.bodies.get(id));
    }
    expect(f2.state.pairParts.get('a|b')).toBe(f1.state.pairParts.get('a|b'));

    // Third frame: only `c` moves. The clean pair keeps its cached
    // intersection; the pairs touching `c` and `c`'s own body are rebuilt.
    const f3 = buildRegionsIncremental(apart(9), [], f2.state);
    expect(f3.state.bodies.get('a')).toBe(f1.state.bodies.get('a'));
    expect(f3.state.bodies.get('c')).not.toBe(f1.state.bodies.get('c'));
    expect(f3.state.pairParts.get('a|b')).toBe(f1.state.pairParts.get('a|b'));
    expect(f3.state.pairParts.get('a|c')).not.toBe(f1.state.pairParts.get('a|c'));
  });

  // The same for the other early-out: one line can produce no overlap at all,
  // so the build stops before the zone — but it has already paid for the body.
  it('carries the body through a single-line frame', () => {
    const one = apart().slice(0, 1);
    const f1 = buildRegionsIncremental(one, [], null);
    expect(f1.state.bodies.size).toBe(1);
    const f2 = buildRegionsIncremental(apart().slice(0, 1), [], f1.state);
    expect(f2.state.bodies.get('a')).toBe(f1.state.bodies.get('a'));
  });

  // The 32-bit ring hash is the cache's lookup workhorse, but alone it would
  // let two different components silently alias — and a false hit hands out the
  // WRONG component's faces. These two squares genuinely collide in the ring
  // hash (brute-forced offline over milliunit-quantized squares; the guard
  // below fails if the hash function ever changes and the pair stops
  // colliding). The key must still tell them apart.
  it('cache keys distinguish components whose 32-bit ring hashes collide', () => {
    const collA: Ring = [
      { x: 11.907, y: 52.731 },
      { x: 18.608, y: 52.731 },
      { x: 18.608, y: 59.432 },
      { x: 11.907, y: 59.432 },
    ];
    const collB: Ring = [
      { x: 112.644, y: 498.852 },
      { x: 121.448, y: 498.852 },
      { x: 121.448, y: 507.656 },
      { x: 112.644, y: 507.656 },
    ];
    const keyA = compCacheKey([collA], ringsBbox([collA]));
    const keyB = compCacheKey([collB], ringsBbox([collB]));
    // Fixture guard: both keys still open with the same ring hash.
    expect(keyA.split('|')[0]).toBe(keyB.split('|')[0]);
    expect(keyA).not.toBe(keyB);
  });
});
