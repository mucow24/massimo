import { describe, it, expect } from 'vitest';
import {
  angleDeg,
  centroid,
  clipSegmentToRect,
  midpoint,
  rotateAround,
  rotatedRectCorners,
  v,
} from './vec';

const nearPt = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('rotatedRectCorners', () => {
  it('returns the 4 corners CW from top-left, unrotated', () => {
    const c = rotatedRectCorners(v(0, 0), 50, 30, 0);
    nearPt(c[0], v(-50, -30)); // TL
    nearPt(c[1], v(50, -30)); // TR
    nearPt(c[2], v(50, 30)); // BR
    nearPt(c[3], v(-50, 30)); // BL
  });

  it('rotates the corners about the given center (y-down / CW)', () => {
    // 90° clockwise: the top-left (-50,-30) swings to (30,-50).
    const c = rotatedRectCorners(v(0, 0), 50, 30, Math.PI / 2);
    nearPt(c[0], v(30, -50));
  });

  it('offsets by a non-origin center', () => {
    const c = rotatedRectCorners(v(100, 200), 10, 10, 0);
    nearPt(c[0], v(90, 190));
    nearPt(c[2], v(110, 210));
  });
});

describe('midpoint', () => {
  it('returns the component-wise average of two points', () => {
    expect(midpoint(v(0, 0), v(10, 4))).toEqual(v(5, 2));
    expect(midpoint(v(-3, 5), v(3, -5))).toEqual(v(0, 0));
  });
});

describe('angleDeg', () => {
  it('measures from +x toward +y (SVG rotate convention)', () => {
    expect(angleDeg(v(1, 0))).toBeCloseTo(0, 9);
    expect(angleDeg(v(0, 1))).toBeCloseTo(90, 9);
    expect(angleDeg(v(-1, 0))).toBeCloseTo(180, 9);
    expect(angleDeg(v(0, -1))).toBeCloseTo(-90, 9);
    expect(angleDeg(v(1, 1))).toBeCloseTo(45, 9);
  });

  it('is scale-invariant for a non-unit vector', () => {
    expect(angleDeg(v(3, 3))).toBeCloseTo(45, 9);
  });
});

describe('rotateAround', () => {
  it('leaves the pivot itself fixed', () => {
    expect(rotateAround(v(5, 5), v(5, 5), Math.PI / 3)).toEqual(v(5, 5));
  });

  it('rotates a point 90° CW about a pivot (y-down frame)', () => {
    // (10,5) is 5 to the right of pivot (5,5). A +90° rotation in the y-down
    // frame sends +x → +y, so it lands 5 BELOW the pivot: (5,10).
    const out = rotateAround(v(10, 5), v(5, 5), Math.PI / 2);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(10, 9);
  });

  it('matches rotate-about-origin when the pivot is the origin', () => {
    const out = rotateAround(v(1, 0), v(0, 0), Math.PI);
    expect(out.x).toBeCloseTo(-1, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });
});

describe('centroid', () => {
  it('averages the points component-wise', () => {
    expect(centroid([v(0, 0), v(10, 0), v(2, 6)])).toEqual(v(4, 2));
  });

  it('returns the point itself for a single input', () => {
    expect(centroid([v(3, 7)])).toEqual(v(3, 7));
  });

  it('returns the origin for empty input (guarded, not NaN)', () => {
    expect(centroid([])).toEqual(v(0, 0));
  });
});

describe('clipSegmentToRect', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };

  it('returns a wholly-inside segment untouched', () => {
    const r = clipSegmentToRect(v(10, 20), v(80, 90), box)!;
    nearPt(r.a, v(10, 20));
    nearPt(r.b, v(80, 90));
  });

  it('trims the end that runs outside, keeping the direction', () => {
    // Rightwards from inside, exiting the x = 100 edge.
    const r = clipSegmentToRect(v(50, 50), v(400, 50), box)!;
    nearPt(r.a, v(50, 50));
    nearPt(r.b, v(100, 50));
  });

  it('trims both ends of a segment that spans the whole box', () => {
    const r = clipSegmentToRect(v(-500, 50), v(500, 50), box)!;
    nearPt(r.a, v(0, 50));
    nearPt(r.b, v(100, 50));
  });

  it('clips a diagonal at the corner it actually crosses', () => {
    // y = x from far outside: enters at (0,0), leaves at (100,100).
    const r = clipSegmentToRect(v(-200, -200), v(300, 300), box)!;
    nearPt(r.a, v(0, 0));
    nearPt(r.b, v(100, 100));
  });

  it('returns null for a segment wholly outside, on either kind of axis', () => {
    expect(clipSegmentToRect(v(200, 10), v(300, 90), box)).toBeNull();
    expect(clipSegmentToRect(v(10, -300), v(90, -200), box)).toBeNull();
    // Parallel to an edge and beyond it — the p === 0 arm.
    expect(clipSegmentToRect(v(-50, 200), v(150, 200), box)).toBeNull();
  });

  it('handles a degenerate point: kept when inside, null when out', () => {
    const r = clipSegmentToRect(v(5, 5), v(5, 5), box)!;
    nearPt(r.a, v(5, 5));
    nearPt(r.b, v(5, 5));
    expect(clipSegmentToRect(v(-5, -5), v(-5, -5), box)).toBeNull();
  });
});
