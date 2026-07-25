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

/** Faces described by cover + geometry, order-independent. */
const describeFaces = (faces: RegionFace[]): string =>
  faces
    .map(
      (f) =>
        `${f.lineIds.join(',')}#${f.area.toFixed(4)}#` +
        f.face.map((r) => r.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')).join('|'),
    )
    .sort()
    .join('\n');

const full = (bands: SegmentBandSpec[]) => describeFaces(buildOverlapRegions(bands, [], []));

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
});
