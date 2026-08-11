import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAP_MODES, snapDraggedStation, type SnapInput, type SnapModes } from './snap';
import { makeLine, makeStation, makeStop } from '../test/fixtures';

const modes = (partial: Partial<SnapModes> = {}): SnapModes => ({
  ...DEFAULT_SNAP_MODES,
  ...partial,
});

// A bare station drag over an empty map: no stations to pair with, so any
// engagement can only come from the guide targets.
function drag(partial: Partial<SnapInput>): SnapInput {
  return {
    draggedId: 's1',
    proposedX: 0,
    proposedY: 0,
    draggedRotation: 0,
    draggedStops: [],
    stations: {},
    lines: {},
    lineCircles: {},
    modes: modes(),
    ...partial,
  };
}

const hGuide = { id: 'g1', orientation: 'horizontal' as const, offset: 100 };
const vGuide = { id: 'g2', orientation: 'vertical' as const, offset: 200 };

describe('snapDraggedStation against alignment guides', () => {
  it('snaps the anchor onto a guide with every mode off (always-on target)', () => {
    const r = snapDraggedStation(
      drag({
        proposedX: 50,
        proposedY: 104,
        modes: modes({ line: false }),
        guideTargets: [hGuide],
      }),
    );
    expect(r.x).toBe(50);
    expect(r.y).toBe(100);
    expect(r.guides).toEqual([
      { from: { x: 50, y: 100 }, to: { x: 50, y: 100 }, alignGuideId: 'g1' },
    ]);
  });

  it('does not engage outside the tolerance', () => {
    const r = snapDraggedStation(drag({ proposedX: 50, proposedY: 130, guideTargets: [hGuide] }));
    expect(r).toMatchObject({ x: 50, y: 130 });
    expect(r.guides).toHaveLength(0);
  });

  it('two crossing guides solve as a corner', () => {
    const r = snapDraggedStation(
      drag({ proposedX: 204, proposedY: 97, guideTargets: [hGuide, vGuide] }),
    );
    expect(r.x).toBeCloseTo(200, 9);
    expect(r.y).toBeCloseTo(100, 9);
    expect(r.guides.map((g) => g.alignGuideId).sort()).toEqual(['g1', 'g2']);
  });

  // A same-axis contest between a guide and a line-mode station alignment:
  // the BETTER-ALIGNED constraint wins the axis, the point snapper's rule.
  // Without this, a guide's stand-in target is the drag's own foot, so its
  // along-axis distance is ~0 and it would beat a 1-unit-perfect corridor
  // alignment from 9 units away — yanking a station off its own line.
  describe('same-axis contest vs a line alignment', () => {
    // s1 at (0,0) with a horizontal stop on L1; the dragged s2 carries the
    // matching stop, adjacent on L1 — a horizontal corridor along y=0.
    const corridor = (): Partial<SnapInput> => ({
      draggedId: 's2',
      draggedStops: [makeStop('L1', { orientation: 'auto-horizontal' })],
      stations: {
        s1: makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
        }),
      },
      lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) },
    });

    it('the corridor wins while it is the better-aligned of the two', () => {
      const r = snapDraggedStation(
        drag({
          ...corridor(),
          proposedX: 100,
          proposedY: 2, // corridor perp 2 < guide perp 6
          guideTargets: [{ id: 'gh', orientation: 'horizontal', offset: 8 }],
        }),
      );
      expect(r.y).toBe(0);
      expect(r.guides.some((g) => g.alignGuideId)).toBe(false);
      // The corridor alignment draws its usual labeled segment.
      expect(r.guides.some((g) => g.label)).toBe(true);
    });

    it('the guide wins once IT is the better-aligned', () => {
      const r = snapDraggedStation(
        drag({
          ...corridor(),
          proposedX: 100,
          proposedY: 6.5, // corridor perp 6.5 > guide perp 1.5
          guideTargets: [{ id: 'gh', orientation: 'horizontal', offset: 8 }],
        }),
      );
      expect(r.y).toBe(8);
      expect(r.guides.map((g) => g.alignGuideId)).toEqual(['gh']);
    });
  });

  it('grid stays the hard constraint: an off-grid guide yields to plain grid', () => {
    const offGrid = { id: 'g3', orientation: 'horizontal' as const, offset: 105 };
    const r = snapDraggedStation(
      drag({
        proposedX: 52,
        proposedY: 103,
        modes: modes({ grid: 'both' }),
        guideTargets: [offGrid],
      }),
    );
    expect(r).toMatchObject({ x: 50, y: 100 });
    expect(r.guides).toHaveLength(0);
    const r2 = snapDraggedStation(
      drag({
        proposedX: 52,
        proposedY: 103,
        modes: modes({ grid: 'both' }),
        guideTargets: [hGuide],
      }),
    );
    expect(r2).toMatchObject({ x: 50, y: 100 });
    expect(r2.guides.map((g) => g.alignGuideId)).toEqual(['g1']);
  });
});
