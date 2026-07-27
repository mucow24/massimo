import { describe, expect, it } from 'vitest';
import { markerEndPath, markerEndRailArc, markerEndRing, markerEndSides } from './markerEnd';
import { rotatedRectCorners, v, type Vec2 } from './vec';

const C = v(10, 20);
const HALF = 7;

// Signed distance along `ow` from the stop center — how far past the center a
// point reaches OUTWARD. The whole feature is about this number: square ends
// reach +half, short ends reach 0, round ends reach +half only on the axis.
const outwardReach = (p: Vec2, ow: Vec2) => (p.x - C.x) * ow.x + (p.y - C.y) * ow.y;
// Distance to the side, perpendicular to travel.
const sideReach = (p: Vec2, ow: Vec2) => (p.x - C.x) * -ow.y + (p.y - C.y) * ow.x;

// Every cardinal + diagonal outward direction: the shapes are built in the
// outward frame, so they must be exactly congruent under rotation.
const DIRECTIONS: Vec2[] = [
  v(1, 0),
  v(0, 1),
  v(-1, 0),
  v(0, -1),
  v(Math.SQRT1_2, Math.SQRT1_2),
  v(-Math.SQRT1_2, Math.SQRT1_2),
];

describe('markerEndRing — short', () => {
  it('never reaches past the stop center, in any direction', () => {
    for (const ow of DIRECTIONS) {
      const ring = markerEndRing(C, ow, HALF, 'short');
      for (const p of ring)
        expect(outwardReach(p, ow)).toBeCloseTo(Math.min(0, outwardReach(p, ow)), 9);
      expect(Math.max(...ring.map((p) => outwardReach(p, ow)))).toBeCloseTo(0, 9);
    }
  });

  it('is the inward half of the marker square — full width, half the length', () => {
    for (const ow of DIRECTIONS) {
      const ring = markerEndRing(C, ow, HALF, 'short');
      expect(ring).toHaveLength(4);
      expect(Math.min(...ring.map((p) => outwardReach(p, ow)))).toBeCloseTo(-HALF, 9);
      expect(Math.max(...ring.map((p) => sideReach(p, ow)))).toBeCloseTo(HALF, 9);
      expect(Math.min(...ring.map((p) => sideReach(p, ow)))).toBeCloseTo(-HALF, 9);
    }
  });
});

describe('markerEndRing — round', () => {
  it('reaches exactly half on the travel axis and nowhere further', () => {
    for (const ow of DIRECTIONS) {
      const ring = markerEndRing(C, ow, HALF, 'round');
      expect(Math.max(...ring.map((p) => outwardReach(p, ow)))).toBeCloseTo(HALF, 2);
      for (const p of ring) expect(outwardReach(p, ow)).toBeLessThanOrEqual(HALF + 1e-9);
    }
  });

  it('keeps every outward vertex on the half-disc of radius half', () => {
    for (const ow of DIRECTIONS) {
      for (const p of markerEndRing(C, ow, HALF, 'round')) {
        if (outwardReach(p, ow) <= 1e-9) continue; // the inward half is a rect
        expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(HALF, 6);
      }
    }
  });

  it('samples the arc finely enough to stay within the flatten tolerance', () => {
    const ring = markerEndRing(C, v(1, 0), HALF, 'round');
    // Chord sagitta of the coarsest arc step must sit under 0.01 world units,
    // the same tolerance the stripe bodies flatten at.
    const outer = ring.filter((p) => outwardReach(p, v(1, 0)) > -1e-9);
    let worst = 0;
    for (let i = 1; i < outer.length; i++) {
      const chord = Math.hypot(outer[i].x - outer[i - 1].x, outer[i].y - outer[i - 1].y);
      worst = Math.max(worst, HALF - Math.sqrt(Math.max(0, HALF * HALF - (chord / 2) ** 2)));
    }
    expect(worst).toBeLessThanOrEqual(0.01 + 1e-9);
  });
});

describe('markerEndRing — winding', () => {
  // Rings are unioned NonZero WITHOUT orientation normalization, so a ring
  // wound against the square's (rotatedRectCorners) cancels the stripe body
  // underneath it and punches a hole in the line's own footprint.
  const signedArea = (ring: Vec2[]) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  };

  it('matches the square marker ring’s orientation', () => {
    const square = rotatedRectCorners(C, HALF, HALF, 0);
    expect(signedArea(Array.from(square))).toBeGreaterThan(0);
    for (const ow of DIRECTIONS) {
      expect(signedArea(markerEndRing(C, ow, HALF, 'short'))).toBeGreaterThan(0);
      expect(signedArea(markerEndRing(C, ow, HALF, 'round'))).toBeGreaterThan(0);
    }
  });

  it('gives each end the area its shape implies', () => {
    // short = half the square exactly; round = that half plus a half-disc,
    // minus the sliver an INSCRIBED polygon loses to its chords (a fraction of
    // a unit at this tolerance — and always short, never over).
    const halfDisc = (Math.PI * HALF * HALF) / 2;
    expect(signedArea(markerEndRing(C, v(1, 0), HALF, 'short'))).toBeCloseTo(2 * HALF * HALF, 6);
    const round = signedArea(markerEndRing(C, v(1, 0), HALF, 'round'));
    expect(round).toBeLessThan(2 * HALF * HALF + halfDisc);
    expect(round).toBeCloseTo(2 * HALF * HALF + halfDisc, 0);
  });
});

describe('markerEndPath', () => {
  it('emits a straight quad for short and an arc for round', () => {
    expect(markerEndPath(C, v(1, 0), HALF, 'short')).not.toContain('A');
    expect(markerEndPath(C, v(1, 0), HALF, 'round')).toContain('A');
  });

  it('closes both shapes', () => {
    expect(markerEndPath(C, v(1, 0), HALF, 'short').trimEnd().endsWith('Z')).toBe(true);
    expect(markerEndPath(C, v(1, 0), HALF, 'round').trimEnd().endsWith('Z')).toBe(true);
  });

  it('sweeps the arc AROUND the outward tip, not back through the body', () => {
    // East-pointing end: the arc runs from (10,27) to (10,13) and must bulge to
    // x = 17. A flipped sweep flag would carve the bulge inward instead — the
    // one error a "contains an A" assertion cannot see.
    const d = markerEndPath(C, v(1, 0), HALF, 'round');
    const arc = /A\s+([\d.]+)\s+([\d.]+)\s+0\s+0\s+([01])\s/.exec(d);
    expect(arc).not.toBeNull();
    expect(Number(arc![1])).toBeCloseTo(HALF, 6);
    expect(arc![3]).toBe('0');
  });
});

describe('markerEndSides', () => {
  it('runs each side rail along the inward half only', () => {
    for (const ow of DIRECTIONS) {
      for (const [from, to] of markerEndSides(C, ow, HALF)) {
        expect(outwardReach(from, ow)).toBeCloseTo(-HALF, 9);
        expect(outwardReach(to, ow)).toBeCloseTo(0, 9);
        expect(Math.abs(sideReach(from, ow))).toBeCloseTo(HALF, 9);
        expect(sideReach(from, ow)).toBeCloseTo(sideReach(to, ow), 9);
      }
    }
  });

  it('gives the two rails opposite sides', () => {
    const [a, b] = markerEndSides(C, v(1, 0), HALF);
    expect(sideReach(a[0], v(1, 0))).toBeCloseTo(-sideReach(b[0], v(1, 0)), 9);
  });
});

describe('markerEndRailArc', () => {
  it('traces the round end at the body edge, matching the painted arc', () => {
    const d = markerEndRailArc(C, v(1, 0), HALF);
    expect(d).toContain('A');
    expect(d).not.toContain('Z');
    const arc = /A\s+([\d.]+)\s+([\d.]+)\s+0\s+0\s+([01])\s/.exec(d);
    expect(Number(arc![1])).toBeCloseTo(HALF, 6);
    expect(arc![3]).toBe('0');
  });
});
