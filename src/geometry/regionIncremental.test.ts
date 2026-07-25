import { describe, expect, it } from 'vitest';
import { buildOverlapRegions, type RegionFace } from './lineRegions';
import { buildRegionsIncremental, type RegionIncrementalState } from './regionIncremental';
import { makeBandSpec } from '../test/fixtures';
import type { SegmentBandSpec } from './interlining';

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

const full = (bands: SegmentBandSpec[]) => describeFaces(buildOverlapRegions(bands, [], []));

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
    expect(describeFaces(r.faces)).toBe(full(bands));
  });

  it('equals a full build after each step of a drag', () => {
    let state: RegionIncrementalState | null = buildRegionsIncremental(grid(), [], null).state;
    for (const dx of [3, 6, 9, 12]) {
      const bands = grid(dx);
      const inc = buildRegionsIncremental(bands, [], state);
      expect(describeFaces(inc.faces)).toBe(full(bands));
      state = inc.state;
    }
  });

  it('equals a full build when a line is removed entirely', () => {
    const state = buildRegionsIncremental(grid(), [], null).state;
    const fewer = grid().filter((b) => b.lines[0].id !== 'vB');
    const inc = buildRegionsIncremental(fewer, [], state);
    expect(describeFaces(inc.faces)).toBe(full(fewer));
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
    expect(describeFaces(inc.faces)).toBe(full(stubbedGrid(-60, 3)));
  });

  // Two lines swapping stripe slots leaves every stripe's geometry byte-identical
  // and the band key untouched, so nothing about the SHAPE of the frame changed —
  // only which line owns which side.
  it('notices two lines swapping stripe slots within a band', () => {
    const state = buildRegionsIncremental(shared(['A', 'B']), [], null).state;
    const inc = buildRegionsIncremental(shared(['B', 'A']), [], state);
    expect(describeFaces(inc.faces)).toBe(full(shared(['B', 'A'])));
  });
});
