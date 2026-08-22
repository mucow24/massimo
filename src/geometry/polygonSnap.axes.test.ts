import { describe, expect, it } from 'vitest';
import { snapPolygonPoint } from './polygonSnap';
import { DEFAULT_SNAP_MODES, SNAP_PERP_TOLERANCE, type SnapModes } from './snap';

const modes = (partial: Partial<SnapModes> = {}): SnapModes => ({
  ...DEFAULT_SNAP_MODES,
  ...partial,
});

// "Snap to all" with every axis family live: the only configuration that can
// put four non-parallel alignments in tolerance at once, which is exactly what
// the pair-selection rule exists to arbitrate.
const allAxes = (partial: Partial<SnapModes> = {}): SnapModes =>
  modes({ line: false, all: 'all', grid: 'off', ...partial });

// A sits on the \ line y = x; B on the / line y = 100 - x. They cross at
// (50, 50) — a corner reachable only by locking both diagonals at once.
const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };

describe('two perpendicular diagonals form a corner', () => {
  it('locks both diagonals instead of projecting onto whichever is better aligned', () => {
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 51 },
      lineTargets: [],
      allTargets: [A, B],
      modes: allAxes(),
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
    expect(r.guides).toHaveLength(2);
  });

  it('holds the corner steady instead of flip-flopping between the two families', () => {
    // Walk diagonally across the corner. Both families stay in tolerance the
    // whole way, so every sample must land on the same solved corner. Sharing
    // one diagonal slot instead yields a different projection per sample.
    const landed = new Set<string>();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const r = snapPolygonPoint({
        proposed: { x: 48 + 4 * t, y: 53 - 4 * t },
        lineTargets: [],
        allTargets: [A, B],
        modes: allAxes(),
      });
      landed.add(`${r.x.toFixed(6)},${r.y.toFixed(6)}`);
    }
    expect([...landed]).toEqual(['50.000000,50.000000']);
  });

  it('discards a lone third axis and corners the perpendicular pair', () => {
    // Adds a vertical alignment 5 off — worse than either diagonal (0.71 and
    // 2.12), so the guard lets the pair through. Three families in tolerance
    // means exactly one complete perpendicular pair, here the diagonals, and
    // the odd axis out has no degree of freedom left to constrain.
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 51 },
      lineTargets: [],
      allTargets: [A, B, { x: 57, y: 900 }],
      modes: allAxes(),
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
    expect(r.guides).toHaveLength(2);
  });

  it('prefers H+V when both perpendicular pairs are available', () => {
    // Four families, each from its own target: V 2 off, H 2 off, the \ exactly
    // through the point, the / 1.41 off. Best-aligned-pair selection would
    // take the \ and pair it with something; the tie-break says H+V.
    const r = snapPolygonPoint({
      proposed: { x: 102, y: 202 },
      lineTargets: [],
      allTargets: [
        { x: 100, y: 500 }, // vertical alignment only
        { x: 500, y: 200 }, // horizontal alignment only
        { x: 0, y: 100 }, // \ through the proposed point
        { x: 0, y: 302 }, // / just off it
      ],
      modes: allAxes(),
    });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(200, 6);
    expect(r.guides).toHaveLength(2);
  });

  it('never corners two diagonals at the cost of a better-aligned straight family', () => {
    // Both diagonals through a SINGLE target cross at that target, so cornering
    // them collapses the point onto it. Sitting 11 units away along a perfect
    // horizontal alignment, that would throw a zero-error snap away to travel
    // 11 units — the opposite of what a snap is for. The horizontal holds.
    const r = snapPolygonPoint({
      proposed: { x: 11, y: 0 },
      lineTargets: [],
      allTargets: [{ x: 0, y: 0 }],
      modes: allAxes(),
    });
    expect(r.x).toBeCloseTo(11, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.guides).toHaveLength(1);
  });

  it('stays inside the corner displacement bound, with no cliff across the diagonals reach', () => {
    // Walk out through the band where a single target's two diagonals are both
    // in tolerance (|d| <= sqrt(2)*tol) while its vertical is NOT. Nothing may
    // displace further than a right-angle corner can, and the result may not
    // jump as the diagonals drop out at the far edge.
    //
    // The sweep starts just past tolerance on purpose: at dx <= 10 the vertical
    // is still admitted (the test is `perpDist > tol`, so equality passes) and
    // the long-standing V×H corner legitimately collapses the point onto the
    // target. That boundary predates this change and is not what is under test.
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i < 100; i++) {
      const dx = 10.05 + i * 0.05; // just past tolerance → 15
      const r = snapPolygonPoint({
        proposed: { x: dx, y: 0 },
        lineTargets: [],
        allTargets: [{ x: 0, y: 0 }],
        modes: allAxes(),
      });
      expect(Math.hypot(r.x - dx, r.y)).toBeLessThanOrEqual(
        Math.SQRT2 * SNAP_PERP_TOLERANCE + 1e-9,
      );
      if (prev) {
        expect(Math.hypot(r.x - prev.x, r.y - prev.y)).toBeLessThanOrEqual(SNAP_PERP_TOLERANCE);
      }
      prev = { x: r.x, y: r.y };
    }
  });

  it('a 45-degree pair corners too, when the two come from different targets', () => {
    // The \ through the origin is 0.71 off, the vertical through (54, 900) is 2
    // off. They meet at 135°, not 90° — still two constraints on two degrees of
    // freedom, and still a corner. It lands where the two lines cross, x = 54
    // on the line y = x.
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 51 },
      lineTargets: [],
      allTargets: [A, { x: 54, y: 900 }],
      modes: allAxes(),
    });
    expect(r.x).toBeCloseTo(54, 6);
    expect(r.y).toBeCloseTo(54, 6);
    expect(r.guides).toHaveLength(2);
  });
});

describe('colinear targets tie on alignment, so the closest one wins', () => {
  // Three colinear stops L/C/R with L being dragged: C and R are both exactly
  // as well aligned, so alignment quality cannot separate them.
  const near = { x: 105, y: 0 };
  const far = { x: 300, y: 0 };

  it('measures against the nearest colinear target, not the first in the pool', () => {
    const r = snapPolygonPoint({
      proposed: { x: 3, y: 2 },
      lineTargets: [far, near], // far first: a strict < on perpDist keeps it
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].from).toMatchObject(near);
  });

  it('anchors the grid-length notch on the nearest colinear target', () => {
    // tens measures whole grid steps FROM the winning target, so the wrong
    // winner quantizes against the wrong origin: 105 - 100 = 5, not 300 - 300.
    const r = snapPolygonPoint({
      proposed: { x: 3, y: 2 },
      lineTargets: [far, near],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off', tens: true }),
    });
    expect(r.x).toBeCloseTo(5, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('keeps one winner along a diagonal run of colinear targets', () => {
    // Diagonal perpDist runs through a cross product, so two colinear targets
    // land ~1 ulp apart and a strict < flips between them as the point moves.
    // The position barely changes; the reported measurement does not.
    const centre = { x: 0, y: 0 };
    const sw = { x: -50, y: -50 };
    const froms = new Set<string>();
    for (let i = 0; i <= 80; i++) {
      const x = 20 + i * 0.05;
      const r = snapPolygonPoint({
        proposed: { x, y: x - 0.31 },
        lineTargets: [centre, sw],
        allTargets: [],
        modes: modes({ line: true, all: 'off', grid: 'off' }),
      });
      expect(r.guides).toHaveLength(1);
      froms.add(`${r.guides[0].from.x},${r.guides[0].from.y}`);
    }
    expect([...froms]).toEqual(['0,0']);
  });

  it('picks the same winner whatever order the caller assembled the pool in', () => {
    // The tie window has to be measured against the family's BEST alignment,
    // not against whatever is currently holding the slot: epsilon-equality is
    // not transitive, so a pairwise fold lets a chain of near-ties walk the
    // winner off the minimum, and the answer then depends on pool order.
    // T1 is the best aligned, T2 ties with it and is nearer, T3 is outside the
    // window and must never win despite being nearest of all.
    const t1 = { x: 1000, y: 0 }; // perp 0
    const t2 = { x: 500, y: 1e-6 }; // perp 1e-6 — tied with t1, closer
    const t3 = { x: 100, y: 2e-6 }; // perp 2e-6 — NOT tied with t1
    const orders = [
      [t1, t2, t3],
      [t1, t3, t2],
      [t2, t1, t3],
      [t2, t3, t1],
      [t3, t1, t2],
      [t3, t2, t1],
    ];
    for (const lineTargets of orders) {
      const r = snapPolygonPoint({
        proposed: { x: 0, y: 0 },
        lineTargets,
        allTargets: [],
        modes: modes({ line: true, all: 'off', grid: 'off' }),
        tolerance: 0.01,
      });
      expect(r.guides).toHaveLength(1);
      expect(r.guides[0].from).toMatchObject(t2);
    }
  });

  it('two crossing diagonal guides corner together', () => {
    // Guides route through `familyOf(guideAxis(...))` now that one loop serves
    // all four orientations, so this is what pins the two 45° orientations
    // landing in DIFFERENT families. Sharing a slot, they could never corner.
    // \ through the origin (y = x) crosses / at intercept 100 (y = 100 − x).
    const r = snapPolygonPoint({
      proposed: { x: 52, y: 51 },
      lineTargets: [],
      allTargets: [],
      modes: modes({ line: false, all: 'off', grid: 'off' }),
      guideTargets: [
        { id: 'gd', orientation: 'diagonal-down', offset: 0 },
        { id: 'gu', orientation: 'diagonal-up', offset: 100 },
      ],
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
    expect(r.guides.map((g) => g.alignGuideId).sort()).toEqual(['gd', 'gu']);
  });

  it('a guide must be STRICTLY better aligned: an exact tie goes to the point target', () => {
    // Both sit 5 off. The guide takes the family only by being strictly better,
    // so the real target keeps it — and the snap reports a measured segment
    // rather than recolouring the guide.
    const r = snapPolygonPoint({
      proposed: { x: 0, y: 100 },
      lineTargets: [],
      allTargets: [{ x: 500, y: 105 }],
      modes: allAxes(),
      guideTargets: [{ id: 'g', orientation: 'horizontal', offset: 95 }],
    });
    expect(r.y).toBeCloseTo(105, 6);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].alignGuideId).toBeUndefined();
  });

  it('a better-aligned guide still beats the nearest point target', () => {
    // Closest-wins settles ties between POINTS. A guide's stand-in target is
    // the drag's own foot, so it keeps contesting on alignment quality alone —
    // otherwise every guide would win its axis by construction.
    const r = snapPolygonPoint({
      proposed: { x: 50, y: 99.4 },
      lineTargets: [],
      allTargets: [
        { x: 65, y: 99 }, // near, 0.4 off
        { x: 500, y: 99 }, // far, equally 0.4 off
      ],
      modes: allAxes(),
      guideTargets: [{ id: 'g', orientation: 'horizontal', offset: 99.5 }],
    });
    expect(r.y).toBeCloseTo(99.5, 6);
    expect(r.guides.map((g) => g.alignGuideId)).toEqual(['g']);
  });
});

describe('a corner may mix a straight axis with a diagonal', () => {
  // The commonest corner in an octolinear map is 135°, not 90°: an edge running
  // straight up meeting one running up-left. Squaring it off means landing on
  // the vertical through one neighbour AND the 45° through the other — two
  // different targets, so the crossing is a real corner, not a vertex to
  // collapse onto.
  const above = { x: 0, y: -200 }; // vertical edge runs up to here
  const upLeft = { x: -100, y: -100 }; // 45° edge runs up-left to here

  it('corners a vertical against a diagonal from a different target', () => {
    const r = snapPolygonPoint({
      proposed: { x: 2, y: 1 },
      lineTargets: [above, upLeft],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.guides).toHaveLength(2);
  });

  it('corners a horizontal against a diagonal from a different target', () => {
    const left = { x: -200, y: 0 };
    const r = snapPolygonPoint({
      proposed: { x: 1, y: 2 },
      lineTargets: [left, upLeft],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.guides).toHaveLength(2);
  });
});
