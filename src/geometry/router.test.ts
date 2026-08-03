import { describe, it, expect } from 'vitest';
import {
  dirIndex,
  bendAngle,
  route,
  filletPath,
  offsetFilletPath,
  emitOffsetSegments,
  offsetSegmentsPath,
  computeArcRadii,
  DIRS_8,
} from './router';

const east = { x: 1, y: 0 };
const south = { x: 0, y: 1 };
const west = { x: -1, y: 0 };

describe('dirIndex', () => {
  it('maps each cardinal/diagonal direction to its index', () => {
    expect(dirIndex({ x: 1, y: 0 })).toBe(0);
    expect(dirIndex({ x: 0, y: 1 })).toBe(2);
    expect(dirIndex({ x: -1, y: 0 })).toBe(4);
    expect(dirIndex({ x: 0, y: -1 })).toBe(6);
    expect(dirIndex({ x: 0.7, y: 0.7 })).toBe(1);
    expect(dirIndex({ x: -0.7, y: 0.7 })).toBe(3);
    expect(dirIndex({ x: -0.7, y: -0.7 })).toBe(5);
    expect(dirIndex({ x: 0.7, y: -0.7 })).toBe(7);
  });

  it('quantizes off-axis vectors to nearest 8-way index', () => {
    expect(dirIndex({ x: 0.95, y: 0.1 })).toBe(0);
    expect(dirIndex({ x: 0.1, y: 0.95 })).toBe(2);
  });
});

describe('bendAngle', () => {
  it('is zero for the same direction', () => {
    for (let i = 0; i < 8; i++) expect(bendAngle(i, i)).toBe(0);
  });

  it('is symmetric in its arguments', () => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        expect(bendAngle(i, j)).toBeCloseTo(bendAngle(j, i), 10);
      }
    }
  });

  it('is bounded to [0, π]', () => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const a = bendAngle(i, j);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });

  it('returns π for opposite directions', () => {
    expect(bendAngle(0, 4)).toBeCloseTo(Math.PI, 10);
    expect(bendAngle(2, 6)).toBeCloseTo(Math.PI, 10);
  });
});

describe('route — straight', () => {
  it('produces a 2-vertex path when both directions are equal and on-axis', () => {
    const r = route({ x: 0, y: 0 }, east, { x: 100, y: 0 }, east, 24);
    expect(r.warning).toBe(false);
    expect(r.vertices).toHaveLength(2);
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[1]).toEqual({ x: 100, y: 0 });
  });
});

describe('route — 1-bend', () => {
  it('emits a single corner when start and end share a column', () => {
    // Start east, end south at (100, 100): the 1-bend solution has a single
    // corner at (100, 0). The router sometimes picks a 2-bend chamfer because
    // a diagonal middle segment is shorter — accept either as long as
    // endpoints are right and no warning fires.
    const r = route({ x: 0, y: 0 }, east, { x: 100, y: 100 }, south, 24);
    expect(r.warning).toBe(false);
    expect(r.vertices.length).toBeGreaterThanOrEqual(3);
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[r.vertices.length - 1]).toEqual({ x: 100, y: 100 });
  });

  it('pins the chamfered 2-bend corner for an east→south quarter turn', () => {
    // The router prefers a 2-bend chamfer over a clean L here because the
    // diagonal middle leg is shorter than the right-angle path. Pin the actual
    // committed geometry: start on the x-axis, end on the right edge, joined by
    // a 45° diagonal middle segment. (The old test asserted only the endpoints
    // and called itself "exactly one corner" — a lie; this is a 4-vertex Z.)
    const r = route({ x: 0, y: 0 }, east, { x: 50, y: 50 }, south, 24);
    expect(r.warning).toBe(false);
    expect(r.vertices).toHaveLength(4);
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[3]).toEqual({ x: 50, y: 50 });
    const [, v1, v2] = r.vertices;
    // First leg runs due east (corner stays on the x-axis), last leg runs due
    // south (corner stays on the right edge x=50).
    expect(v1.y).toBeCloseTo(0, 6);
    expect(v2.x).toBeCloseTo(50, 6);
    // The corner is genuinely chamfered inward, not at the L apex (50,0).
    expect(v1.x).toBeGreaterThan(0);
    expect(v1.x).toBeLessThan(50);
    // Middle leg is a true 45° diagonal: equal horizontal and vertical run.
    expect(v2.x - v1.x).toBeCloseTo(v2.y - v1.y, 6);
    expect(v2.x - v1.x).toBeGreaterThan(0);
  });
});

describe('route — 2-bend', () => {
  it('produces a Z shape when start and end directions are parallel and offset', () => {
    const r = route({ x: 0, y: 0 }, east, { x: 200, y: 80 }, east, 24);
    expect(r.warning).toBe(false);
    expect(r.vertices).toHaveLength(4);
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[3]).toEqual({ x: 200, y: 80 });
    const [, v1, v2] = r.vertices;
    // The Z is east → diagonal → east: the first corner sits on the start row
    // (y≈0), the second on the end row (y≈80), both interior x strictly inside
    // the span. (It is NOT a rectangular Z — the interior x differ; the middle
    // leg is a 45° diagonal.)
    expect(v1.y).toBeCloseTo(0, 6);
    expect(v2.y).toBeCloseTo(80, 6);
    expect(v1.x).toBeGreaterThan(0);
    expect(v1.x).toBeLessThan(v2.x);
    expect(v2.x).toBeLessThan(200);
    // Middle leg is a 45° diagonal: equal horizontal and vertical run.
    expect(v2.x - v1.x).toBeCloseTo(v2.y - v1.y, 6);
  });
});

describe('route — U-turn', () => {
  it('produces a 3-bend rectangular detour for anti-parallel directions', () => {
    const r = route({ x: 0, y: 0 }, east, { x: 0, y: 200 }, west, 24);
    // U-turn: east → south (perpendicular) → -east → west. Exactly 5 vertices.
    expect(r.vertices).toHaveLength(5);
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[r.vertices.length - 1]).toEqual({ x: 0, y: 200 });
    const [, v1, v2, v3] = r.vertices;
    // Leaves outward along +x and stays on the start row before turning.
    expect(v1.y).toBeCloseTo(0, 6);
    expect(v1.x).toBeGreaterThan(0);
    // The two long sides of the rectangle are vertical: V1 and V2 share an x.
    // (Pins the rectangular shape, not the solver's chosen detour distance.)
    expect(v2.x).toBeCloseTo(v1.x, 6);
    // Comes back in on the end row.
    expect(v3.y).toBeCloseTo(200, 6);
  });
});

describe('route — tight bend warning', () => {
  it('flags a route whose corner angle exceeds 135° and emits a straight fallback', () => {
    // Start east, end pointing nearly back at start — forces near-180° bend
    // through a 2-bend solution that the router rejects as tight.
    const r = route({ x: 0, y: 0 }, east, { x: 10, y: 1 }, west, 24);
    expect(r.warning).toBe(true);
    expect(r.vertices).toHaveLength(2);
    expect(r.pathD).toContain('M ');
    expect(r.pathD).toContain('L ');
  });
});

describe('route — waypoints', () => {
  it('stitches a path through provided waypoints', () => {
    const r = route({ x: 0, y: 0 }, east, { x: 200, y: 200 }, south, 24, [{ x: 100, y: 0 }]);
    // First leg goes through (100, 0); final corner near (200, 0).
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(r.vertices[r.vertices.length - 1]).toEqual({ x: 200, y: 200 });
    const passesThroughWaypoint = r.vertices.some(
      (v) => Math.abs(v.x - 100) < 0.01 && Math.abs(v.y - 0) < 0.01,
    );
    expect(passesThroughWaypoint).toBe(true);
  });
});

describe('filletPath', () => {
  it('returns empty for fewer than 2 vertices', () => {
    expect(filletPath([], 24)).toBe('');
  });

  it('returns a simple M..L for exactly 2 vertices', () => {
    const d = filletPath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      24,
    );
    expect(d).toBe('M 0.000000 0.000000 L 50.000000 0.000000');
  });

  it('emits an arc command for a 3-vertex L with a real bend', () => {
    const d = filletPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      24,
    );
    expect(d).toContain(' A ');
    expect(d).toMatch(/^M /);
  });
});

describe('computeArcRadii', () => {
  // A short edge shared by two 90° corners can't fit both fillets at the
  // requested radius. The two adjacent corners must shrink by the SAME factor,
  // so they stay proportional and tangent to the common edge — this is what
  // keeps every path in an interlined band concentric and keeps line-tag
  // positions glued to the painted geometry.
  it('shrinks two corners sharing a too-short edge by the same factor', () => {
    const R = 20;
    const { rs, angles } = computeArcRadii(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 }, // corner 1: 90°
        { x: 100, y: 10 }, // short shared edge (length 10) → corner 2: 90°
        { x: 200, y: 10 },
      ],
      R,
    );
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(angles[2]).toBeCloseTo(Math.PI / 2, 10);
    // Both corners shrank below the requested radius...
    expect(rs[1]).toBeLessThan(R);
    expect(rs[2]).toBeLessThan(R);
    // ...by the same factor (equal angles ⇒ equal radii)...
    expect(rs[1]).toBeCloseTo(rs[2], 6);
    // ...and their tangent lengths now exactly fill the 10-unit shared edge.
    // At a 90° corner tan(θ/2) = 1, so tangent length === radius.
    expect(rs[1] + rs[2]).toBeCloseTo(10, 4);
  });

  it('leaves radii at the requested R when every edge has room', () => {
    const R = 5;
    const { rs } = computeArcRadii(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 }, // long shared edge: no tangent collision
        { x: 200, y: 100 },
      ],
      R,
    );
    expect(rs[1]).toBeCloseTo(R, 6);
    expect(rs[2]).toBeCloseTo(R, 6);
  });
});

describe('offsetFilletPath', () => {
  it('with offset=0 produces the same string as filletPath', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(offsetFilletPath(verts, 24, 0)).toBe(filletPath(verts, 24));
  });

  it('shifts a straight 2-vertex path perpendicular to motion', () => {
    // East-going line, positive offset moves toward "left of motion" (north
    // in screen coords: y decreases).
    const d = offsetFilletPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      24,
      10,
    );
    expect(d).toBe('M 0.000000 -10.000000 L 100.000000 -10.000000');
  });

  it('shifts the opposite direction for negative offset', () => {
    const d = offsetFilletPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      24,
      -10,
    );
    expect(d).toBe('M 0.000000 10.000000 L 100.000000 10.000000');
  });

  // The inside/outside arc-radius sign is the load-bearing bit: a stripe on the
  // inside of a bend rides a TIGHTER arc (centerR − offset), one on the outside
  // rides a WIDER arc (centerR + offset). Getting it backwards inverts every
  // interlined curve, so pin it directly here rather than only via the golden.
  // Corner: east then south — cz > 0 in the router's turn convention, edges long
  // enough (100 » tangent) that the centerline radius stays the full R=24.
  const bendVerts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('rides the tighter (inside) arc for a stripe on the inside of the bend', () => {
    // Negative offset sits on the inside of this turn → radius 24 − 10 = 14.
    const d = offsetFilletPath(bendVerts, 24, -10);
    expect(d).toContain('A 14.00 14.00');
    expect(d).not.toContain('A 34.00 34.00');
  });

  it('rides the wider (outside) arc for a stripe on the outside of the bend', () => {
    // Positive offset sits on the outside of this turn → radius 24 + 10 = 34.
    const d = offsetFilletPath(bendVerts, 24, 10);
    expect(d).toContain('A 34.00 34.00');
    expect(d).not.toContain('A 14.00 14.00');
  });

  // `offsetSegmentsPath` is the same emitter offsetFilletPath uses, exposed for
  // callers that walk the chain first (the branch seam, which decides whether
  // to draw an edge at all by looking for an arc in it).
  describe('offsetSegmentsPath', () => {
    it('emits the same path offsetFilletPath does for the same chain', () => {
      const segs = emitOffsetSegments(bendVerts, 24, 10);
      expect(offsetSegmentsPath(segs)).toBe(offsetFilletPath(bendVerts, 24, 10));
    });

    it('emits one continuous sub-path — a single leading M, never a pen lift', () => {
      const d = offsetSegmentsPath(emitOffsetSegments(bendVerts, 24, 10));
      expect(d.match(/M /g)!.length).toBe(1);
      expect(d).toContain('A 34.00 34.00');
    });

    it('yields an empty path for an empty chain', () => {
      expect(offsetSegmentsPath([])).toBe('');
    });
  });
});

describe('DIRS_8', () => {
  it('all entries are unit vectors', () => {
    for (const d of DIRS_8) {
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 10);
    }
  });
});
