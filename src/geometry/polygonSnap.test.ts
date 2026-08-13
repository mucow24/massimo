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
      expect(r.guides[0].label).toBe('50.0');
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
      expect(r.guides.map((g) => g.label).sort()).toEqual(['100.0', '200.0']);
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

  describe('anchors — a rigid set of points snapping as one translation', () => {
    // Anchors model a whole-item drag with several snappable corners: every
    // anchor generates alignment candidates, the winning alignment moves the
    // whole set, and `proposed` stays the grid subject and the returned frame.
    const A = { x: 0, y: 0 }; // the primary (== proposed)
    const B = { x: 100, y: 50 }; // a far corner of the same rigid box

    it('a non-primary anchor engages and translates the primary by its delta', () => {
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [{ x: 102, y: 300 }],
        modes: modes({ all: 'all', grid: 'off' }),
      });
      expect(r.x).toBeCloseTo(2, 6);
      expect(r.y).toBeCloseTo(0, 6);
      // The guide runs from the target to the ENGAGED anchor's aligned
      // position (102, 50) — not to the primary.
      expect(r.guides).toHaveLength(1);
      expect(r.guides[0].label).toBe('250.0');
      expect(r.guides[0].to).toMatchObject({ x: 102, y: 50 });
    });

    it('cross-anchor corner: V via one anchor + H via another both lock', () => {
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [
          { x: 102, y: 300 }, // vertical alignment, reachable only via B
          { x: 300, y: 3 }, // horizontal alignment, reachable only via A
        ],
        modes: modes({ all: 'all', grid: 'off' }),
      });
      expect(r.x).toBeCloseTo(2, 6);
      expect(r.y).toBeCloseTo(3, 6);
      expect(r.guides.map((g) => g.label).sort()).toEqual(['247.0', '298.0']);
    });

    it('within one slot the better-aligned anchor wins', () => {
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [
          { x: 101, y: 300 }, // via B: off by 1
          { x: 5, y: 300 }, // via A: off by 5
        ],
        modes: modes({ all: 'all', grid: 'off' }),
      });
      expect(r.x).toBeCloseTo(1, 6);
      expect(r.guides).toHaveLength(1);
    });

    it('an alignment guide engages through any anchor and emits its marker', () => {
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [],
        modes: modes({ grid: 'off' }),
        guideTargets: [{ id: 'g1', orientation: 'horizontal', offset: 53 }],
      });
      expect(r.x).toBeCloseTo(0, 6);
      expect(r.y).toBeCloseTo(3, 6);
      expect(r.guides).toHaveLength(1);
      expect(r.guides[0].alignGuideId).toBe('g1');
    });

    it('a diagonal target projects the engaged anchor and tows the set', () => {
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [{ x: 130, y: 77 }],
        modes: modes({ all: 'all', grid: 'off' }),
      });
      expect(r.x).toBeCloseTo(1.5, 6);
      expect(r.y).toBeCloseTo(-1.5, 6);
    });

    it('grid stays the hard constraint in the PRIMARY frame', () => {
      // The alignment via B lands the primary at x=10 — on the lattice, so the
      // lock survives; grid 'vertical' leaves Y alone.
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, B],
        lineTargets: [],
        allTargets: [{ x: 110, y: 300 }],
        modes: modes({ all: 'all', grid: 'vertical' }),
      });
      expect(r.x).toBeCloseTo(10, 6);
      expect(r.y).toBeCloseTo(0, 6);
      expect(r.guides).toHaveLength(1);
    });

    it('tens notches the ENGAGED anchor a clean grid step from the target', () => {
      const b = { x: 100, y: 54 };
      const r = snapPolygonPoint({
        proposed: A,
        anchors: [A, b],
        lineTargets: [],
        allTargets: [{ x: 102, y: 30 }],
        modes: modes({ all: 'all', tens: true, grid: 'off' }),
      });
      // V locks via b (x -> 102 at the anchor, +2 in the primary frame); the
      // free Y slides so the anchor sits a whole grid step from the target:
      // 54 - 30 = 24 notches to 20, pulling the set down by 4.
      expect(r.x).toBeCloseTo(2, 6);
      expect(r.y).toBeCloseTo(-4, 6);
      expect(r.guides[0].label).toBe('20.0');
    });
  });

  describe('snap to grid length (tens) — notch the free axis a whole grid step from the target', () => {
    it('notches the free Y of a vertical alignment to a multiple of the grid length', () => {
      // Vertical lock (x→100); Y slides free. With tens on, Y notches to the
      // nearest multiple of 10 from the target's Y (0) → 50 (not the raw 53).
      const r = snapPolygonPoint({
        proposed: { x: 102, y: 53 },
        lineTargets: [{ x: 100, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
      });
      expect(r.x).toBeCloseTo(100, 6);
      expect(r.y).toBeCloseTo(50, 6);
      expect(r.guides[0].label).toBe('50.0');
    });

    it('leaves the free axis free when tens is off (baseline)', () => {
      const r = snapPolygonPoint({
        proposed: { x: 102, y: 53 },
        lineTargets: [{ x: 100, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: false }),
      });
      expect(r.y).toBeCloseTo(53, 6);
    });

    it('notches the free X of a horizontal alignment', () => {
      const r = snapPolygonPoint({
        proposed: { x: 53, y: 102 },
        lineTargets: [{ x: 0, y: 100 }],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
      });
      expect(r.x).toBeCloseTo(50, 6);
      expect(r.y).toBeCloseTo(100, 6);
    });

    it('notches an all-mode alignment (works without line mode)', () => {
      // The new behavior must engage on a "Snap to all" alignment too — line
      // mode is off here, so this proves tens is not gated on line.
      const r = snapPolygonPoint({
        proposed: { x: 203, y: 47 },
        lineTargets: [],
        allTargets: [{ x: 200, y: 0 }],
        modes: modes({ line: false, all: 'vertical', tens: true }),
      });
      expect(r.x).toBeCloseTo(200, 6);
      expect(r.y).toBeCloseTo(50, 6);
    });

    it('tracks the active grid interval (20)', () => {
      // Y=26 notches to 20 on a 20px grid (would be 30 on the default 10px).
      const r = snapPolygonPoint({
        proposed: { x: 101, y: 26 },
        lineTargets: [{ x: 100, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
        gridInterval: 20,
      });
      expect(r.y).toBeCloseTo(20, 6);
    });

    it('notches along a diagonal alignment (clean distance from the target)', () => {
      // Proposed sits near the +45° line through the origin; tens pins the
      // slide to a clean 50 units (a multiple of 10) from the target.
      const r = snapPolygonPoint({
        proposed: { x: 34, y: 37 },
        lineTargets: [{ x: 0, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
      });
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(50, 4);
      expect(r.x).toBeCloseTo(r.y, 4); // still on the diagonal
      expect(r.guides[0].label).toBe('50.0');
    });

    it('leaves a corner untouched (no free DOF to notch)', () => {
      const r = snapPolygonPoint({
        proposed: { x: 101, y: 199 },
        lineTargets: [
          { x: 100, y: 0 },
          { x: 0, y: 200 },
        ],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
      });
      expect(r.x).toBeCloseTo(100, 6);
      expect(r.y).toBeCloseTo(200, 6);
      expect(r.guides).toHaveLength(2);
    });

    it('yields to grid: when grid snapping is on, grid owns quantization (no tens notch)', () => {
      // Grid 'vertical' locks X to the on-grid target (10) and leaves Y free;
      // tens must NOT then notch Y — grid is the hard constraint that wins.
      const r = snapPolygonPoint({
        proposed: { x: 12, y: 53 },
        lineTargets: [{ x: 10, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: true, grid: 'vertical' }),
      });
      expect(r.x).toBeCloseTo(10, 6);
      expect(r.y).toBeCloseTo(53, 6);
    });

    it('drops the guide when the notch lands the point exactly on the target', () => {
      // Tight tolerance so the vertical lock engages while the horizontal one
      // doesn't; Y=4 notches to 0 → the point coincides with the target, so
      // there is no meaningful guide to draw.
      const r = snapPolygonPoint({
        proposed: { x: 101, y: 4 },
        lineTargets: [{ x: 100, y: 0 }],
        allTargets: [],
        modes: modes({ line: true, tens: true }),
        tolerance: 3,
      });
      expect(r.x).toBeCloseTo(100, 6);
      expect(r.y).toBeCloseTo(0, 6);
      expect(r.guides).toHaveLength(0);
    });

    it('does not apply to single-DOF edge resizes (constrain set)', () => {
      // Edge resizes opt out: the caller only uses one axis, so a notched
      // perpendicular guide would be misleading. Y stays the raw slide value.
      const r = snapPolygonPoint({
        proposed: { x: 73, y: 53 },
        lineTargets: [],
        allTargets: [{ x: 70, y: 0 }],
        modes: modes({ all: 'vertical', tens: true }),
        constrain: 'x',
      });
      expect(r.x).toBeCloseTo(70, 6);
      expect(r.y).toBeCloseTo(53, 6); // not notched to 50
    });
  });
});
