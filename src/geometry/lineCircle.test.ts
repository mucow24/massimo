import { describe, expect, it } from 'vitest';
import {
  arcTangentPolygon,
  circleAngleAt,
  pointAtAngle,
  projectToCircle,
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
