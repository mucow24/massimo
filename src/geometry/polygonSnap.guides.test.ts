import { describe, expect, it } from 'vitest';
import { snapPolygonPoint } from './polygonSnap';
import { DEFAULT_SNAP_MODES, type SnapModes } from './snap';

const modes = (partial: Partial<SnapModes> = {}): SnapModes => ({
  ...DEFAULT_SNAP_MODES,
  ...partial,
});
const noTargets = { lineTargets: [], allTargets: [] };
const hGuide = { id: 'g1', orientation: 'horizontal' as const, offset: 100 };
const vGuide = { id: 'g2', orientation: 'vertical' as const, offset: 30 };

describe('snapPolygonPoint against alignment guides', () => {
  it('snaps to a guide with every snap mode off (always-on target)', () => {
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 103 },
      ...noTargets,
      modes: modes({ line: false, all: 'off' }),
      guideTargets: [hGuide],
    });
    expect(r.x).toBe(50);
    expect(r.y).toBe(100);
    // Engagement is reported as a marker (the canvas recolors the guide), not
    // a drawn segment with a distance chip.
    expect(r.guides).toEqual([
      { from: { x: 50, y: 100 }, to: { x: 50, y: 100 }, alignGuideId: 'g1' },
    ]);
  });

  it('does not engage outside the perpendicular tolerance', () => {
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 120 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hGuide],
    });
    expect(r).toMatchObject({ x: 50, y: 120 });
    expect(r.guides).toHaveLength(0);
  });

  it('a nearer point target beats a farther guide on the same axis', () => {
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 99.4 },
      lineTargets: [],
      allTargets: [{ x: 400, y: 99 }],
      modes: modes({ all: 'all' }),
      guideTargets: [hGuide],
    });
    expect(r.y).toBe(99);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].alignGuideId).toBeUndefined();
    expect(r.guides[0].label).toBeDefined();
  });

  it('a guide corner-locks with a point alignment on the other axis', () => {
    const r = snapPolygonPoint({
      proposed: { x: 32, y: 103 },
      lineTargets: [],
      allTargets: [{ x: 30, y: 999 }],
      modes: modes({ all: 'all' }),
      guideTargets: [hGuide],
    });
    expect(r).toMatchObject({ x: 30, y: 100 });
    const marker = r.guides.filter((g) => g.alignGuideId === 'g1');
    const segments = r.guides.filter((g) => !g.alignGuideId);
    expect(marker).toHaveLength(1);
    expect(segments).toHaveLength(1);
  });

  it('two crossing guides corner-lock together', () => {
    const r = snapPolygonPoint({
      proposed: { x: 33, y: 103 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hGuide, vGuide],
    });
    expect(r).toMatchObject({ x: 30, y: 100 });
    expect(r.guides.map((g) => g.alignGuideId).sort()).toEqual(['g1', 'g2']);
  });

  it('constrain keeps only the guides that move the constrained axis', () => {
    // 'y' = only snaps that move Y → horizontal guides engage, vertical don't.
    const rY = snapPolygonPoint({
      proposed: { x: 33, y: 103 },
      ...noTargets,
      modes: modes(),
      constrain: 'y',
      guideTargets: [hGuide, vGuide],
    });
    expect(rY).toMatchObject({ x: 33, y: 100 });
    const rX = snapPolygonPoint({
      proposed: { x: 33, y: 103 },
      ...noTargets,
      modes: modes(),
      constrain: 'x',
      guideTargets: [hGuide, vGuide],
    });
    expect(rX).toMatchObject({ x: 30, y: 103 });
  });

  it('grid is still the hard constraint: an off-grid guide yields to plain grid', () => {
    const offGrid = { id: 'g3', orientation: 'horizontal' as const, offset: 105 };
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 103 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
      guideTargets: [offGrid],
    });
    expect(r).toMatchObject({ x: 50, y: 100 });
    expect(r.guides).toHaveLength(0);
    // An on-grid guide engages, with the free axis gridded.
    const r2 = snapPolygonPoint({
      proposed: { x: 52, y: 103 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
      guideTargets: [hGuide],
    });
    expect(r2).toMatchObject({ x: 50, y: 100 });
    expect(r2.guides.map((g) => g.alignGuideId)).toEqual(['g1']);
  });

  it('tens never notches off a guide (there is no anchor point to measure from)', () => {
    const r = snapPolygonPoint({
      proposed: { x: 53, y: 102 },
      ...noTargets,
      modes: modes({ tens: true }),
      guideTargets: [hGuide],
    });
    expect(r).toMatchObject({ x: 53, y: 100 });
  });
});

// The \ diagonal through the origin (y = x) and the / one at intercept 100
// (y = 100 − x).
const dDown = { id: 'gd', orientation: 'diagonal-down' as const, offset: 0 };
const dUp = { id: 'gu', orientation: 'diagonal-up' as const, offset: 100 };

describe('snapPolygonPoint against diagonal guides', () => {
  it('snaps to the foot of a diagonal guide, reported as a marker', () => {
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 54 },
      ...noTargets,
      modes: modes({ line: false, all: 'off' }),
      guideTargets: [dDown],
    });
    expect(r.x).toBeCloseTo(52, 12);
    expect(r.y).toBeCloseTo(52, 12);
    expect(r.guides).toEqual([
      { from: { x: r.x, y: r.y }, to: { x: r.x, y: r.y }, alignGuideId: 'gd' },
    ]);
    const r2 = snapPolygonPoint({
      proposed: { x: 48, y: 50 },
      ...noTargets,
      modes: modes({ line: false, all: 'off' }),
      guideTargets: [dUp],
    });
    expect(r2.x).toBeCloseTo(49, 12);
    expect(r2.y).toBeCloseTo(51, 12);
    expect(r2.guides.map((g) => g.alignGuideId)).toEqual(['gu']);
  });

  it('the tolerance is perpendicular distance, not the intercept delta', () => {
    // Intercept miss 13 → true distance 13/√2 ≈ 9.2, inside the 10 tolerance.
    const rIn = snapPolygonPoint({
      proposed: { x: 50, y: 63 },
      ...noTargets,
      modes: modes(),
      guideTargets: [dDown],
    });
    expect(rIn.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
    // Intercept miss 16 → distance ≈ 11.3, out.
    const rOut = snapPolygonPoint({
      proposed: { x: 50, y: 66 },
      ...noTargets,
      modes: modes(),
      guideTargets: [dDown],
    });
    expect(rOut).toMatchObject({ x: 50, y: 66 });
    expect(rOut.guides).toHaveLength(0);
  });

  it('an H+V corner still beats a diagonal guide running through it', () => {
    // The \ through (30, 100) — intercept 70 — passes through the corner the
    // two straight guides lock; the corner is the stronger snap.
    const through = { id: 'gd2', orientation: 'diagonal-down' as const, offset: 70 };
    const r = snapPolygonPoint({
      proposed: { x: 33, y: 103 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hGuide, vGuide, through],
    });
    expect(r).toMatchObject({ x: 30, y: 100 });
    expect(r.guides.map((g) => g.alignGuideId).sort()).toEqual(['g1', 'g2']);
  });

  it('a diagonal guide contests a single-axis winner on displacement', () => {
    const dNear = { id: 'gd3', orientation: 'diagonal-down' as const, offset: 44 };
    // H displacement 2 beats the diagonal's 3/√2 ≈ 2.12? No — 2 < 2.12, H wins.
    const rH = snapPolygonPoint({
      proposed: { x: 50, y: 98 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hGuide, dNear],
    });
    expect(rH).toMatchObject({ x: 50, y: 100 });
    expect(rH.guides.map((g) => g.alignGuideId)).toEqual(['g1']);
    // Nudge down: H displacement 3 loses to the diagonal's 3/√2.
    const rD = snapPolygonPoint({
      proposed: { x: 50, y: 97 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hGuide, dNear],
    });
    expect(rD.x).toBeCloseTo(51.5, 12);
    expect(rD.y).toBeCloseTo(95.5, 12);
    expect(rD.guides.map((g) => g.alignGuideId)).toEqual(['gd3']);
  });

  it('a better-aligned diagonal point target beats the guide', () => {
    // The all-mode diagonal through (0, 1) is 0.7 units away; the guide 1.4.
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 52 },
      lineTargets: [],
      allTargets: [{ x: 0, y: 1 }],
      modes: modes({ all: 'all' }),
      guideTargets: [dDown],
    });
    expect(r.x).toBeCloseTo(50.5, 12);
    expect(r.y).toBeCloseTo(51.5, 12);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].alignGuideId).toBeUndefined();
    expect(r.guides[0].label).toBeDefined();
  });

  it('a single-DOF x/y constrain excludes diagonal guides entirely', () => {
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 51 },
      ...noTargets,
      modes: modes(),
      constrain: 'y',
      guideTargets: [dDown],
    });
    expect(r).toMatchObject({ x: 50, y: 51 });
    expect(r.guides).toHaveLength(0);
  });

  it('grid stays hard: an off-lattice diagonal guide yields to plain grid', () => {
    // Intercept 5 on a 10-grid never passes through a crossing.
    const offLattice = { id: 'gd4', orientation: 'diagonal-down' as const, offset: 5 };
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 53 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
      guideTargets: [offLattice],
    });
    expect(r).toMatchObject({ x: 50, y: 50 });
    expect(r.guides).toHaveLength(0);
    // On-lattice engages and lands on a crossing ON the guide.
    const r2 = snapPolygonPoint({
      proposed: { x: 52, y: 53 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
      guideTargets: [dDown],
    });
    expect(r2).toMatchObject({ x: 50, y: 50 });
    expect(r2.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
  });

  it('a bounded guide gates on the foot, per orientation', () => {
    // y = 100 spanning x ∈ [200, 400]: in-span foot engages, out-of-span not.
    const hBounded = { ...hGuide, extent: { center: 300, halfLength: 100 } };
    const rIn = snapPolygonPoint({
      proposed: { x: 250, y: 103 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hBounded],
    });
    expect(rIn).toMatchObject({ x: 250, y: 100 });
    const rOut = snapPolygonPoint({
      proposed: { x: 50, y: 103 },
      ...noTargets,
      modes: modes(),
      guideTargets: [hBounded],
    });
    expect(rOut).toMatchObject({ x: 50, y: 103 });
    expect(rOut.guides).toHaveLength(0);
    // x = 30 spanning y ∈ [150, 250].
    const vBounded = { ...vGuide, extent: { center: 200, halfLength: 50 } };
    const rV = snapPolygonPoint({
      proposed: { x: 33, y: 100 },
      ...noTargets,
      modes: modes(),
      guideTargets: [vBounded],
    });
    expect(rV).toMatchObject({ x: 33, y: 100 });
    expect(rV.guides).toHaveLength(0);
    // y = x spanning x ∈ [40, 60].
    const dBounded = { ...dDown, extent: { center: 50 * Math.SQRT2, halfLength: 10 * Math.SQRT2 } };
    const rD = snapPolygonPoint({
      proposed: { x: 80, y: 84 },
      ...noTargets,
      modes: modes(),
      guideTargets: [dBounded],
    });
    expect(rD).toMatchObject({ x: 80, y: 84 });
    expect(rD.guides).toHaveLength(0);
    const rDIn = snapPolygonPoint({
      proposed: { x: 50, y: 54 },
      ...noTargets,
      modes: modes({ line: false, all: 'off' }),
      guideTargets: [dBounded],
    });
    expect(rDIn.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
  });

  it('tens never notches off a diagonal guide, and the marker still shows', () => {
    const r = snapPolygonPoint({
      proposed: { x: 53, y: 52 },
      ...noTargets,
      modes: modes({ tens: true }),
      guideTargets: [dDown],
    });
    expect(r.x).toBeCloseTo(52.5, 12);
    expect(r.y).toBeCloseTo(52.5, 12);
    expect(r.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
  });
});
