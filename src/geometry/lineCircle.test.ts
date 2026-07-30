import { describe, expect, it } from 'vitest';
import {
  CIRCLE_CARDINAL_STEP,
  arcTangentPolygon,
  circleAngleAt,
  lineCirclesForRect,
  pointAtAngle,
  projectToCircle,
  snapPointToCircle,
  tangentAtAngle,
  wrapAngleToPi,
  type CircleSpec,
} from './lineCircle';
import { emitOffsetSegments } from './router';
import type { Vec2 } from './vec';

const C: CircleSpec = { x: 100, y: 100, radius: 70 };

describe('projection basics', () => {
  it('projects onto the circumference, center degenerating to angle 0', () => {
    expect(projectToCircle(C, { x: 300, y: 100 })).toEqual({ x: 170, y: 100 });
    expect(projectToCircle(C, { x: 100, y: 100 })).toEqual({ x: 170, y: 100 });
    const p = projectToCircle(C, { x: 100, y: 400 });
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(170, 9);
  });

  it('angle and point round-trip', () => {
    for (const theta of [0, 0.7, Math.PI / 2, 2.5, -2.1]) {
      expect(circleAngleAt(C, pointAtAngle(C, theta))).toBeCloseTo(
        Math.atan2(Math.sin(theta), Math.cos(theta)),
        12,
      );
    }
  });

  it('tangent is perpendicular to the radial direction', () => {
    for (const theta of [0, 0.9, 2.2, -1.3]) {
      const t = tangentAtAngle(theta);
      expect(t.x * Math.cos(theta) + t.y * Math.sin(theta)).toBeCloseTo(0, 12);
      expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 12);
    }
  });
});

describe('wrapAngleToPi', () => {
  it('normalizes into (−π, π]', () => {
    expect(wrapAngleToPi(0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngleToPi(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
    expect(wrapAngleToPi(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 12);
    expect(wrapAngleToPi(2 * Math.PI)).toBeCloseTo(0, 12);
    expect(wrapAngleToPi(5 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('breaks the antipodal tie toward +π (deterministic clockwise sweep)', () => {
    expect(wrapAngleToPi(Math.PI)).toBe(Math.PI);
    expect(wrapAngleToPi(-Math.PI)).toBe(Math.PI);
  });
});

// Walk the polygon exactly as the renderer does and collect the pieces.
function walk(verts: Vec2[], radius: number, offset: number) {
  const segs = emitOffsetSegments(verts, radius, offset);
  const total = segs.reduce((a, s) => a + s.length, 0);
  return { segs, total };
}

// Sample points along the walked path (piece endpoints are enough — arcs are
// checked at both ends and lines are chords of nothing).
function pieceEndpoints(verts: Vec2[], radius: number, offset: number): Vec2[] {
  return emitOffsetSegments(verts, radius, offset).flatMap((s) => [s.from, s.to]);
}

describe('arcTangentPolygon', () => {
  it('starts and ends exactly on the circle at the given angles', () => {
    const verts = arcTangentPolygon(C, 0.3, 1.1);
    const a = verts[0];
    const b = verts[verts.length - 1];
    const pa = pointAtAngle(C, 0.3);
    const pb = pointAtAngle(C, 1.4);
    expect(a.x).toBeCloseTo(pa.x, 12);
    expect(a.y).toBeCloseTo(pa.y, 12);
    expect(b.x).toBeCloseTo(pb.x, 12);
    expect(b.y).toBeCloseTo(pb.y, 12);
  });

  it('renders as the true arc: walked length = r·|delta| for both sweeps', () => {
    for (const delta of [0.8, -0.8, 2.0, -2.0, Math.PI]) {
      const verts = arcTangentPolygon(C, 0.5, delta);
      const { total } = walk(verts, C.radius, 0);
      expect(total).toBeCloseTo(C.radius * Math.abs(delta), 3);
    }
  });

  it('every walked point sits on the circle (centerline) or its concentric offsets', () => {
    for (const delta of [1.2, -2.4, Math.PI]) {
      const verts = arcTangentPolygon(C, -0.7, delta);
      for (const offset of [0, 7, -7]) {
        // Positive offset is left-of-motion: radially OUT for a clockwise
        // (delta > 0) sweep, IN for counter-clockwise.
        const expected = C.radius + (delta > 0 ? offset : -offset);
        for (const p of pieceEndpoints(verts, C.radius, offset)) {
          expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(expected, 3);
        }
        const { total } = walk(verts, C.radius, offset);
        expect(total).toBeCloseTo(expected * Math.abs(delta), 2);
      }
    }
  });

  it('splits wide sweeps so every interior corner stays ≤ 90°', () => {
    // A half-circle needs at least two pieces (a single tangent intersection
    // would sit at infinity).
    const verts = arcTangentPolygon(C, 0, Math.PI);
    expect(verts.length).toBeGreaterThanOrEqual(4);
    for (const v of verts.slice(1, -1)) {
      // Interior vertices sit OUTSIDE the circle at bounded miter distance
      // (≤ r/cos(45°) for ≤90° pieces).
      const d = Math.hypot(v.x - C.x, v.y - C.y);
      expect(d).toBeGreaterThan(C.radius);
      expect(d).toBeLessThanOrEqual(C.radius / Math.cos(Math.PI / 4) + 1e-9);
    }
  });

  it('degenerates to the chord for a ~zero sweep', () => {
    const verts = arcTangentPolygon(C, 1, 1e-9);
    expect(verts.length).toBe(2);
  });
});

describe('lineCirclesForRect (marquee membership)', () => {
  const circles = {
    c1: { id: 'c1', x: 100, y: 100, radius: 70 },
    locked: { id: 'locked', x: 400, y: 400, radius: 70, locked: true },
  };

  it('hits when the rect touches the RIM, not the empty interior', () => {
    // A box over the east rim segment.
    expect(lineCirclesForRect(circles, { x0: 160, y0: 80, x1: 200, y1: 120 }, false)).toEqual([
      'c1',
    ]);
    // A box wholly inside the ring touches no rim — a marquee dragged inside
    // the circle must not grab the guide.
    expect(lineCirclesForRect(circles, { x0: 90, y0: 90, x1: 110, y1: 110 }, false)).toEqual([]);
    // A box around the whole circle hits.
    expect(lineCirclesForRect(circles, { x0: 0, y0: 0, x1: 200, y1: 200 }, false)).toEqual(['c1']);
    // Inverted corners normalize (drags go in any direction).
    expect(lineCirclesForRect(circles, { x0: 200, y0: 120, x1: 160, y1: 80 }, false)).toEqual([
      'c1',
    ]);
  });

  it('skips locked circles unless asked (the Alt-marquee recovery path)', () => {
    const rect = { x0: 300, y0: 300, x1: 500, y1: 500 };
    expect(lineCirclesForRect(circles, rect, false)).toEqual([]);
    expect(lineCirclesForRect(circles, rect, true)).toEqual(['locked']);
  });
});

describe('snapPointToCircle (cardinal magnetism)', () => {
  // The eight cardinals of C, indexed by 45° step from due east.
  const cardinal = (k: number): Vec2 => pointAtAngle(C, k * CIRCLE_CARDINAL_STEP);
  const near = (a: Vec2, b: Vec2, digits = 9) => {
    expect(a.x).toBeCloseTo(b.x, digits);
    expect(a.y).toBeCloseTo(b.y, digits);
  };

  it('is exactly the plain rim projection when cardinals are off', () => {
    for (const p of [
      { x: 300, y: 100 },
      { x: 100, y: 400 },
      { x: 12, y: 34 },
      { x: 100, y: 100 },
    ])
      expect(snapPointToCircle(C, p, null)).toEqual(projectToCircle(C, p));
  });

  it('pulls a near-miss at 9 o’clock onto the west cardinal exactly', () => {
    // 0.05 rad shy of due west ⇒ 3.5 world units of arc at r=70, well inside 10.
    const p = pointAtAngle(C, Math.PI - 0.05);
    near(snapPointToCircle(C, p, 10), { x: 30, y: 100 });
  });

  it('reaches all eight cardinals, and only lands ON one when engaged', () => {
    for (let k = 0; k < 8; k++) {
      const target = cardinal(k);
      const askew = pointAtAngle(C, k * CIRCLE_CARDINAL_STEP + 0.06);
      near(snapPointToCircle(C, askew, 10), target);
    }
  });

  it('leaves the midpoint between two cardinals alone', () => {
    // 22.5° is the farthest possible from any cardinal: 27.5 units of arc here.
    const p = pointAtAngle(C, CIRCLE_CARDINAL_STEP / 2);
    near(snapPointToCircle(C, p, 10), p);
  });

  it('engages just inside the arc tolerance and not just outside', () => {
    const inside = pointAtAngle(C, (10 - 0.1) / C.radius);
    const outside = pointAtAngle(C, (10 + 0.1) / C.radius);
    near(snapPointToCircle(C, inside, 10), cardinal(0));
    near(snapPointToCircle(C, outside, 10), outside);
  });

  it('measures the window as ARC, so a tight ring is magnetic where a huge one is not', () => {
    // Same angular offset (0.1 rad), same tolerance — opposite outcomes.
    const small = { x: 0, y: 0, radius: 40 };
    const huge = { x: 0, y: 0, radius: 400 };
    near(snapPointToCircle(small, pointAtAngle(small, 0.1), 10), pointAtAngle(small, 0));
    near(snapPointToCircle(huge, pointAtAngle(huge, 0.1), 10), pointAtAngle(huge, 0.1));
  });

  it('treats angles either side of ±π as the same west cardinal', () => {
    near(snapPointToCircle(C, pointAtAngle(C, Math.PI - 0.02), 10), { x: 30, y: 100 });
    near(snapPointToCircle(C, pointAtAngle(C, -Math.PI + 0.02), 10), { x: 30, y: 100 });
  });

  it('is idempotent — re-seating a seated point does not drift', () => {
    // moveStation re-projects whatever the drag hands it, so a seat that moved
    // on a second pass would creep along the rim for free.
    for (const theta of [0.06, 1.3, -2.9, Math.PI - 0.01]) {
      const once = snapPointToCircle(C, pointAtAngle(C, theta), 10);
      near(snapPointToCircle(C, once, 10), once, 12);
    }
  });

  it('survives a degenerate radius instead of emitting NaN', () => {
    const p = snapPointToCircle({ x: 5, y: 5, radius: 0 }, { x: 9, y: 9 }, 10);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});
