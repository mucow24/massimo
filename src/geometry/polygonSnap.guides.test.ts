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
