import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAP_MODES,
  guideAxis,
  guideFoot,
  guideMoveVector,
  guideNeighbourReadout,
  guideNudgeDelta,
  guideOffsetOf,
  guidePerpDist,
  guideSegmentInBox,
  snapDraggedStation,
  type SnapInput,
  type SnapModes,
} from './snap';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { GuideOrientation } from '../model/types';

const ORIENTATIONS: GuideOrientation[] = ['horizontal', 'vertical', 'diagonal-down', 'diagonal-up'];

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

describe('guide-line geometry helpers', () => {
  it('offset-of / foot / perp-dist agree, for every orientation', () => {
    const p = { x: 30, y: 70 };
    const q = { x: -14, y: 3 };
    for (const o of ORIENTATIONS) {
      const c = guideOffsetOf(o, p);
      // p lies on the guide through itself.
      expect(guidePerpDist(o, c, p)).toBeCloseTo(0, 12);
      expect(guideFoot(o, c, p)).toEqual(p);
      // Any point's foot lands ON the line, reached perpendicular to it, at
      // exactly perp-dist away.
      const foot = guideFoot(o, c, q);
      expect(guideOffsetOf(o, foot)).toBeCloseTo(c, 12);
      const a = guideAxis(o);
      expect((foot.x - q.x) * a.x + (foot.y - q.y) * a.y).toBeCloseTo(0, 12);
      expect(Math.hypot(foot.x - q.x, foot.y - q.y)).toBeCloseTo(guidePerpDist(o, c, q), 12);
    }
  });

  it('a diagonal intercept miss reads as true distance (intercept / √2)', () => {
    expect(guidePerpDist('diagonal-down', 10, { x: 0, y: 20 })).toBeCloseTo(10 / Math.SQRT2, 12);
    expect(guidePerpDist('diagonal-up', 0, { x: 5, y: 5 })).toBeCloseTo(10 / Math.SQRT2, 12);
  });

  it('nudge delta projects a translation; the move vector inverts it', () => {
    expect(guideNudgeDelta('diagonal-down', 3, 5)).toBe(2); // dy − dx
    expect(guideNudgeDelta('diagonal-up', 3, 5)).toBe(8); // dy + dx
    for (const o of ORIENTATIONS) {
      const mv = guideMoveVector(o, 7);
      expect(guideNudgeDelta(o, mv.x, mv.y)).toBeCloseTo(7, 12);
      // The tow really is perpendicular travel: it moves the guide by
      // exactly |d| for the straight orientations, |d|/√2 for diagonals.
      const expected = o === 'horizontal' || o === 'vertical' ? 7 : 7 / Math.SQRT2;
      expect(Math.hypot(mv.x, mv.y)).toBeCloseTo(expected, 12);
    }
  });

  it('clips a diagonal to the box and culls a complete miss', () => {
    // Box x 0..100, y 0..100. \ at intercept 50 enters (0,50), exits (50,100).
    expect(guideSegmentInBox('diagonal-down', 50, 0, 0, 100, 100)).toEqual({
      x1: 0,
      y1: 50,
      x2: 50,
      y2: 100,
    });
    // / at intercept 50 runs (0,50) → (50,0).
    expect(guideSegmentInBox('diagonal-up', 50, 0, 0, 100, 100)).toEqual({
      x1: 0,
      y1: 50,
      x2: 50,
      y2: 0,
    });
    expect(guideSegmentInBox('diagonal-down', 300, 0, 0, 100, 100)).toBeNull();
    expect(guideSegmentInBox('diagonal-up', -1, 0, 0, 100, 100)).toBeNull();
    // Horizontal/vertical span the box edge-to-edge, offset inside it or not.
    expect(guideSegmentInBox('horizontal', 250, 0, 0, 100, 100)).toEqual({
      x1: 0,
      y1: 250,
      x2: 100,
      y2: 250,
    });
  });
});

describe('guideNeighbourReadout', () => {
  const h = (id: string, offset: number) => ({ id, orientation: 'horizontal' as const, offset });

  it('brackets the drag with the nearest parallel guide on each side, below first', () => {
    // Cursor way off the line: the span still anchors at the cursor's FOOT on
    // the dragged guide, so it lands beside the pointer along the line.
    const r = guideNeighbourReadout('horizontal', 100, { x: 250, y: 999 }, [
      h('far-below', 40),
      h('below', 60),
      h('above', 160),
      h('far-above', 300),
    ]);
    expect(r).toEqual([
      { from: { x: 250, y: 100 }, to: { x: 250, y: 60 }, label: '40' },
      { from: { x: 250, y: 100 }, to: { x: 250, y: 160 }, label: '60' },
    ]);
  });

  it('measures only its own orientation, and reports nothing without one', () => {
    const others = [
      { id: 'v', orientation: 'vertical' as const, offset: 120 },
      { id: 'd', orientation: 'diagonal-down' as const, offset: 120 },
      { id: 'u', orientation: 'diagonal-up' as const, offset: 120 },
    ];
    expect(guideNeighbourReadout('horizontal', 100, { x: 0, y: 0 }, others)).toEqual([]);
    expect(guideNeighbourReadout('horizontal', 100, { x: 0, y: 0 }, [])).toEqual([]);
  });

  it('reports one span when the drag has run past every guide on a side', () => {
    const r = guideNeighbourReadout('horizontal', 400, { x: 0, y: 0 }, [h('a', 60), h('b', 160)]);
    expect(r.map((g) => g.label)).toEqual(['240']);
  });

  it('a coincident guide is not a neighbour', () => {
    expect(guideNeighbourReadout('horizontal', 100, { x: 0, y: 0 }, [h('same', 100)])).toEqual([]);
  });

  it('a diagonal measures TRUE perpendicular distance, not the intercept delta', () => {
    const r = guideNeighbourReadout('diagonal-down', 0, { x: 50, y: 50 }, [
      { id: 'd', orientation: 'diagonal-down', offset: 100 },
    ]);
    expect(r).toHaveLength(1);
    // Intercept delta 100 → true distance 100/√2 ≈ 70.7, and the drawn segment
    // is exactly as long as the number claims.
    expect(r[0].label).toBe('71');
    expect(Math.hypot(r[0].to.x - r[0].from.x, r[0].to.y - r[0].from.y)).toBeCloseTo(
      100 / Math.SQRT2,
      9,
    );
    expect(r[0].from).toEqual({ x: 50, y: 50 });
  });
});

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

  describe('diagonal guides', () => {
    // The \ through the origin (y = x).
    const dDown = { id: 'gd', orientation: 'diagonal-down' as const, offset: 0 };

    it('snaps the anchor onto the foot, reported as a marker', () => {
      const r = snapDraggedStation(
        drag({
          proposedX: 50,
          proposedY: 54,
          modes: modes({ line: false }),
          guideTargets: [dDown],
        }),
      );
      expect(r.x).toBeCloseTo(52, 9);
      expect(r.y).toBeCloseTo(52, 9);
      expect(r.guides).toEqual([
        { from: { x: r.x, y: r.y }, to: { x: r.x, y: r.y }, alignGuideId: 'gd' },
      ]);
    });

    it('the tolerance is perpendicular distance, not the intercept delta', () => {
      // Intercept miss 13 → true distance ≈ 9.2, inside; miss 16 → 11.3, out.
      const rIn = snapDraggedStation(drag({ proposedX: 50, proposedY: 63, guideTargets: [dDown] }));
      expect(rIn.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
      const rOut = snapDraggedStation(
        drag({ proposedX: 50, proposedY: 66, guideTargets: [dDown] }),
      );
      expect(rOut).toMatchObject({ x: 50, y: 66 });
      expect(rOut.guides).toHaveLength(0);
    });

    it('corner-locks with a straight guide at their intersection', () => {
      // y = x meets y = 100 at (100, 100).
      const r = snapDraggedStation(
        drag({ proposedX: 97, proposedY: 103, guideTargets: [hGuide, dDown] }),
      );
      expect(r.x).toBeCloseTo(100, 9);
      expect(r.y).toBeCloseTo(100, 9);
      expect(r.guides.map((g) => g.alignGuideId).sort()).toEqual(['g1', 'gd']);
    });

    it('contests its axis on alignment quality against an all-mode diagonal', () => {
      // t1 at the origin offers the same \ family through (0,0); the guide
      // sits at intercept 6. Whichever the drag is better aligned with wins.
      const withStation = (): Partial<SnapInput> => ({
        stations: { t1: makeStation({ id: 't1', x: 0, y: 0 }) },
        modes: modes({ line: false, all: 'all' }),
        guideTargets: [{ id: 'gd6', orientation: 'diagonal-down', offset: 6 }],
      });
      const rStation = snapDraggedStation(drag({ ...withStation(), proposedX: 50, proposedY: 52 }));
      expect(rStation.y - rStation.x).toBeCloseTo(0, 9);
      expect(rStation.guides.some((g) => g.alignGuideId)).toBe(false);
      expect(rStation.guides.some((g) => g.label)).toBe(true);
      const rGuide = snapDraggedStation(drag({ ...withStation(), proposedX: 50, proposedY: 55.5 }));
      expect(rGuide.y - rGuide.x).toBeCloseTo(6, 9);
      expect(rGuide.guides.map((g) => g.alignGuideId)).toEqual(['gd6']);
    });

    it('grid stays hard: off-lattice yields to plain grid, on-lattice engages', () => {
      const offLattice = { id: 'gd5', orientation: 'diagonal-down' as const, offset: 5 };
      const r = snapDraggedStation(
        drag({
          proposedX: 52,
          proposedY: 53,
          modes: modes({ grid: 'both' }),
          guideTargets: [offLattice],
        }),
      );
      expect(r).toMatchObject({ x: 50, y: 50 });
      expect(r.guides).toHaveLength(0);
      const r2 = snapDraggedStation(
        drag({
          proposedX: 52,
          proposedY: 53,
          modes: modes({ grid: 'both' }),
          guideTargets: [dDown],
        }),
      );
      expect(r2.x).toBeCloseTo(50, 9);
      expect(r2.y).toBeCloseTo(50, 9);
      expect(r2.guides.map((g) => g.alignGuideId)).toEqual(['gd']);
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
