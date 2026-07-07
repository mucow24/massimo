import { describe, it, expect } from 'vitest';
import { polygonSnapAnchor, polygonCentroid } from './polygon';
import { snapPolygonPoint } from './polygonSnap';
import { DEFAULT_SNAP_MODES, type SnapModes } from './snap';

const modes = (partial: Partial<SnapModes>): SnapModes => ({ ...DEFAULT_SNAP_MODES, ...partial });

describe('polygon geometry helpers', () => {
  it('polygonSnapAnchor picks the highest, then leftmost vertex', () => {
    const verts = [
      { x: 10, y: 5 },
      { x: -3, y: 0 }, // highest (min y)
      { x: -8, y: 0 }, // also highest, more left -> wins the tie
      { x: 4, y: 9 },
    ];
    expect(polygonSnapAnchor(verts)).toEqual({ x: -8, y: 0 });
  });

  it('polygonCentroid averages the vertices', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ x: 5, y: 5 });
  });
});

describe('snapPolygonPoint', () => {
  const noTargets = { lineTargets: [], allTargets: [] };

  it('grid mode snaps to the nearest grid intersection', () => {
    const r = snapPolygonPoint({
      proposed: { x: 12, y: 23 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
    });
    expect(r).toMatchObject({ x: 10, y: 20 });
    expect(r.guides).toHaveLength(0);
  });

  it('grid horizontal/vertical lock only one axis', () => {
    expect(
      snapPolygonPoint({
        proposed: { x: 12, y: 23 },
        ...noTargets,
        modes: modes({ grid: 'horizontal' }),
      }),
    ).toMatchObject({ x: 12, y: 20 });
    expect(
      snapPolygonPoint({
        proposed: { x: 12, y: 23 },
        ...noTargets,
        modes: modes({ grid: 'vertical' }),
      }),
    ).toMatchObject({ x: 10, y: 23 });
  });

  it('threads a 5px gridInterval through the plain-grid path', () => {
    expect(
      snapPolygonPoint({
        proposed: { x: 7, y: 7 },
        ...noTargets,
        modes: modes({ grid: 'both' }),
        gridInterval: 5,
      }),
    ).toMatchObject({ x: 5, y: 5 });
    // Same input on the default 10px grid lands elsewhere.
    expect(
      snapPolygonPoint({ proposed: { x: 7, y: 7 }, ...noTargets, modes: modes({ grid: 'both' }) }),
    ).toMatchObject({ x: 10, y: 10 });
  });

  it('threads a 5px gridInterval through the corner reconciliation path', () => {
    // A vertical-aligned target (x=5) and a horizontal-aligned one (y=5) form a
    // corner at (5,5): off the 10px lattice (would degrade) but valid on 5px.
    const lineTargets = [
      { x: 5, y: 999 },
      { x: 999, y: 5 },
    ];
    const r = snapPolygonPoint({
      proposed: { x: 6, y: 6 },
      lineTargets,
      allTargets: [],
      modes: modes({ line: true, grid: 'both' }),
      gridInterval: 5,
    });
    expect(r).toMatchObject({ x: 5, y: 5 });
    expect(r.guides).toHaveLength(2);
  });

  it('line mode aligns vertically to a sibling vertex (snaps x) and emits a guide', () => {
    const r = snapPolygonPoint({
      proposed: { x: 102, y: 50 },
      lineTargets: [{ x: 100, y: 0 }],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(50, 6); // y free
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('line mode aligns diagonally to a sibling vertex', () => {
    // Target at origin; proposed near the +45° (y=x) line through it.
    const r = snapPolygonPoint({
      proposed: { x: 40, y: 44 },
      lineTargets: [{ x: 0, y: 0 }],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    // Projects onto y = x -> both coords meet near 42.
    expect(r.x).toBeCloseTo(42, 6);
    expect(r.y).toBeCloseTo(42, 6);
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('line mode ignores allTargets (only the current polygon snaps)', () => {
    const r = snapPolygonPoint({
      proposed: { x: 102, y: 50 },
      lineTargets: [],
      allTargets: [{ x: 100, y: 0 }], // a station, but "line" must not see it
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(102, 6); // unchanged
    expect(r.guides).toHaveLength(0);
  });

  it('all mode snaps to a station stop-center and honors the direction sub-setting', () => {
    // 'vertical' direction => only X may align.
    const r = snapPolygonPoint({
      proposed: { x: 203, y: 80 },
      lineTargets: [],
      allTargets: [{ x: 200, y: 0 }],
      modes: modes({ line: false, all: 'vertical', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(200, 6);
    expect(r.y).toBeCloseTo(80, 6); // horizontal not allowed
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('all mode includes other polygons vertices', () => {
    const r = snapPolygonPoint({
      proposed: { x: 51, y: 49 },
      lineTargets: [],
      allTargets: [{ x: 50, y: 50 }],
      modes: modes({ line: false, all: 'all', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
  });

  it('corner: vertical + horizontal both engage -> snaps to the intersection', () => {
    const r = snapPolygonPoint({
      proposed: { x: 101, y: 199 },
      lineTargets: [
        { x: 100, y: 0 }, // shares X
        { x: 0, y: 200 }, // shares Y
      ],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(200, 6);
    expect(r.guides.length).toBe(2);
  });

  describe('guide distance labels', () => {
    it('a single-axis alignment guide carries the rounded distance label', () => {
      const r = snapPolygonPoint({
        proposed: { x: 102, y: 50 },
        lineTargets: [{ x: 100, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, all: 'off', grid: 'off' }),
      });
      // Snapped point (100, 50) is 50 from the target (100, 0).
      expect(r.guides[0].label).toBe('50');
    });

    it('corner-snap guides each carry their own distance label', () => {
      const r = snapPolygonPoint({
        proposed: { x: 101, y: 199 },
        lineTargets: [
          { x: 100, y: 0 }, // shares X → guide of length 200
          { x: 0, y: 200 }, // shares Y → guide of length 100
        ],
        allTargets: [],
        modes: modes({ line: true, all: 'off', grid: 'off' }),
      });
      expect(r.guides.map((g) => g.label).sort()).toEqual(['100', '200']);
    });
  });

  it('out of tolerance leaves the point unchanged with no guides', () => {
    // (500, 123) is far from any axis through the two targets (incl. diagonals).
    const r = snapPolygonPoint({
      proposed: { x: 500, y: 123 },
      lineTargets: [{ x: 100, y: 0 }],
      allTargets: [{ x: 0, y: 0 }],
      modes: modes({ line: true, all: 'all', grid: 'off' }),
    });
    expect(r).toMatchObject({ x: 500, y: 123 });
    expect(r.guides).toHaveLength(0);
  });

  describe("constrain: 'x' | 'y' (single-DOF consumers like edge resizes)", () => {
    it("constrain 'x' ignores a horizontal-only alignment (no snap, no guide)", () => {
      const r = snapPolygonPoint({
        proposed: { x: 73, y: 3 },
        lineTargets: [],
        allTargets: [{ x: 999, y: 5 }], // horizontal axis only — perpendicular to X
        modes: modes({ all: 'all', grid: 'off' }),
        constrain: 'x',
      });
      expect(r).toMatchObject({ x: 73, y: 3 });
      expect(r.guides).toHaveLength(0);
    });

    it("constrain 'x' still locks X to a vertical alignment, with a guide", () => {
      const r = snapPolygonPoint({
        proposed: { x: 73, y: 3 },
        lineTargets: [],
        allTargets: [{ x: 70, y: 999 }],
        modes: modes({ all: 'all', grid: 'off' }),
        constrain: 'x',
      });
      expect(r.x).toBeCloseTo(70, 6);
      expect(r.y).toBeCloseTo(3, 6);
      expect(r.guides).toHaveLength(1);
    });

    it("constrain 'x' narrows grid 'both' to the X axis only", () => {
      const r = snapPolygonPoint({
        proposed: { x: 73, y: 3 },
        lineTargets: [],
        allTargets: [],
        modes: modes({ grid: 'both' }),
        constrain: 'x',
      });
      expect(r).toMatchObject({ x: 70, y: 3 });
    });

    it("constrain 'y' mirrors: horizontal alignments and Y grid only", () => {
      const r = snapPolygonPoint({
        proposed: { x: 73, y: 3 },
        lineTargets: [],
        allTargets: [{ x: 999, y: 5 }],
        modes: modes({ all: 'all', grid: 'off' }),
        constrain: 'y',
      });
      expect(r.x).toBeCloseTo(73, 6);
      expect(r.y).toBeCloseTo(5, 6);
      expect(r.guides).toHaveLength(1);
    });
  });

  describe('grid as a hard constraint', () => {
    it('grid vertical drops a vertical lock to an off-grid sibling → plain grid', () => {
      // Vertical line at x=5 (off grid). Grid 'vertical' constrains X (the
      // perpendicular) → the lock can't engage → snap purely to grid.
      const r = snapPolygonPoint({
        proposed: { x: 6, y: 50 },
        lineTargets: [{ x: 5, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, grid: 'vertical' }),
      });
      expect(r.x).toBeCloseTo(10, 6);
      expect(r.y).toBeCloseTo(50, 6);
      expect(r.guides).toHaveLength(0);
    });

    it('grid vertical keeps a horizontal lock (perp Y free) and notches X', () => {
      // Horizontal line at y=20 (on grid). Grid 'vertical' constrains only X,
      // so the lock holds Y=20 and X notches to 30.
      const r = snapPolygonPoint({
        proposed: { x: 27, y: 23 },
        lineTargets: [{ x: 0, y: 20 }],
        allTargets: [],
        modes: modes({ line: true, grid: 'vertical' }),
      });
      expect(r.x).toBeCloseTo(30, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(1);
    });

    it("grid 'both' keeps an on-grid corner", () => {
      const r = snapPolygonPoint({
        proposed: { x: 12, y: 22 },
        lineTargets: [
          { x: 10, y: 0 }, // shares X (on grid)
          { x: 0, y: 20 }, // shares Y (on grid)
        ],
        allTargets: [],
        modes: modes({ line: true, grid: 'both' }),
      });
      expect(r.x).toBeCloseTo(10, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(2);
    });

    it("grid 'both' degrades an off-grid corner to its grid-valid axis", () => {
      // Corner (5,20): X=5 off grid, Y=20 on grid. The horizontal (Y) lock
      // survives; X notches to grid.
      const r = snapPolygonPoint({
        proposed: { x: 7, y: 22 },
        lineTargets: [
          { x: 5, y: 0 }, // shares X=5 (off grid)
          { x: 0, y: 20 }, // shares Y=20 (on grid)
        ],
        allTargets: [],
        modes: modes({ line: true, grid: 'both' }),
      });
      expect(r.x).toBeCloseTo(10, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(1);
    });

    it('grid vertical intersects a diagonal lock with the grid column', () => {
      // +45° line y=x through origin; grid 'vertical' pins X=20, Y follows.
      const r = snapPolygonPoint({
        proposed: { x: 23, y: 25 },
        lineTargets: [{ x: 0, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, grid: 'vertical' }),
      });
      expect(r.x).toBeCloseTo(20, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(1);
    });

    it("grid 'both' snaps a diagonal lock to the lattice when it exists", () => {
      // y=x through origin → c=0 is a grid multiple → grid points on the line.
      const r = snapPolygonPoint({
        proposed: { x: 23, y: 25 },
        lineTargets: [{ x: 0, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, grid: 'both' }),
      });
      expect(r.x).toBeCloseTo(20, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(1);
    });

    it("grid 'both' drops a diagonal lock that misses the lattice", () => {
      // Line y=x−5 through (5,0): c=−5 is not a grid multiple → no grid points
      // on the line → plain grid, no guide.
      const r = snapPolygonPoint({
        proposed: { x: 28, y: 23 },
        lineTargets: [{ x: 5, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, grid: 'both' }),
      });
      expect(r.x).toBeCloseTo(30, 6);
      expect(r.y).toBeCloseTo(20, 6);
      expect(r.guides).toHaveLength(0);
    });
  });
});
