import { describe, it, expect } from 'vitest';
import { dot, midpoint, sub } from './vec';
import { guideLabelSide } from './snap';
import {
  normalizeRotation,
  snapAngle,
  svgImageCorners,
  resizeSvgImageCorner,
  resizeSvgImageEdge,
  rotateSvgImageTo,
  svgImageDimensionGuides,
  svgImageSnapAnchor,
  SVG_IMAGE_MIN_SIZE,
  type SvgImageGeom,
} from './svgImage';

// A 100×60 image centered at the origin, unrotated → corners at (±50, ±30).
const base = (over: Partial<SvgImageGeom> = {}): SvgImageGeom => ({
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  rotation: 0,
  ...over,
});

// Fixed 6-digit tolerance. (It used to advertise an `eps` parameter and then
// `void` it, so a caller passing 0.5 silently got 6-digit strictness.)
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('normalizeRotation', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-10)).toBe(350);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(45)).toBe(45);
  });
});

describe('snapAngle', () => {
  it('passes through when not snapping', () => {
    expect(snapAngle(10, false)).toBe(10);
    expect(snapAngle(247.3, false)).toBe(247.3);
  });
  it('rounds to the nearest 22.5° multiple when snapping', () => {
    expect(snapAngle(10, true)).toBe(0);
    expect(snapAngle(30, true)).toBe(22.5);
    expect(snapAngle(34, true)).toBe(45);
    expect(snapAngle(40, true)).toBe(45);
  });
});

describe('svgImageCorners', () => {
  it('returns the 4 world corners CW from top-left, unrotated', () => {
    const c = svgImageCorners(base());
    near(c[0], { x: -50, y: -30 }); // TL
    near(c[1], { x: 50, y: -30 }); // TR
    near(c[2], { x: 50, y: 30 }); // BR
    near(c[3], { x: -50, y: 30 }); // BL
  });
  it('rotates the corners about the center', () => {
    // 90° clockwise: the original top-left (-50,-30) swings to (30,-50).
    const c = svgImageCorners(base({ rotation: 90 }));
    near(c[0], { x: 30, y: -50 });
  });
});

describe('resizeSvgImageCorner (always aspect-locked)', () => {
  it('pins the opposite corner in world space (unrotated)', () => {
    // Drag bottom-right (corner 2); top-left (corner 0) is the anchor.
    const box = resizeSvgImageCorner(base(), 2, { x: 70, y: 30 });
    const tl = svgImageCorners({ ...base(), ...box })[0];
    near(tl, { x: -50, y: -30 });
  });
  it('preserves the width/height ratio', () => {
    const box = resizeSvgImageCorner(base(), 2, { x: 70, y: 30 });
    expect(box.width / box.height).toBeCloseTo(100 / 60, 9);
  });
  it('pins the opposite corner even when rotated 90°', () => {
    const img = base({ rotation: 90 });
    const anchorBefore = svgImageCorners(img)[0]; // TL anchor
    const box = resizeSvgImageCorner(img, 2, { x: 120, y: 80 });
    const anchorAfter = svgImageCorners({ ...img, ...box })[0];
    near(anchorAfter, anchorBefore);
  });
  it('clamps to the min size when dragged onto the anchor (aspect yields)', () => {
    // Pointer == anchor corner → zero extent → both axes clamp to MIN, even
    // though that breaks the aspect ratio.
    const box = resizeSvgImageCorner(base(), 2, { x: -50, y: -30 });
    expect(box.width).toBe(SVG_IMAGE_MIN_SIZE);
    expect(box.height).toBe(SVG_IMAGE_MIN_SIZE);
  });
});

describe('resizeSvgImageEdge (single-axis stretch)', () => {
  it('changes only width and pins the opposite edge (right edge, unrotated)', () => {
    const box = resizeSvgImageEdge(base(), 1, { x: 80, y: 17 });
    expect(box.height).toBe(60); // untouched dimension passed through verbatim
    expect(box.width).toBeCloseTo(130, 9);
    // Opposite (left) edge midpoint stays at world (-50, 0).
    const c = svgImageCorners({ ...base(), ...box });
    near({ x: (c[0].x + c[3].x) / 2, y: (c[0].y + c[3].y) / 2 }, { x: -50, y: 0 });
  });
  it('changes only height and pins the opposite edge (top edge, unrotated)', () => {
    const box = resizeSvgImageEdge(base(), 0, { x: 13, y: -50 });
    expect(box.width).toBe(100);
    expect(box.height).toBeCloseTo(80, 9);
    // Opposite (bottom) edge midpoint stays at world (0, 30).
    const c = svgImageCorners({ ...base(), ...box });
    near({ x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 }, { x: 0, y: 30 });
  });
  it('pins the opposite edge in world space when rotated 90° (right edge)', () => {
    // The rotation term in resizeSvgImageEdge is only exercised here: at 0°
    // `rotate()` is the identity, so the unrotated cases above would still pass
    // even if the orientation handling were dropped. Resizing the right edge
    // must keep the LEFT edge's world midpoint pinned at any rotation.
    const img = base({ rotation: 90 });
    const before = svgImageCorners(img);
    const leftMidBefore = {
      x: (before[0].x + before[3].x) / 2,
      y: (before[0].y + before[3].y) / 2,
    };
    const box = resizeSvgImageEdge(img, 1, { x: 40, y: 25 });
    expect(box.height).toBe(60); // cross-axis untouched
    const after = svgImageCorners({ ...img, ...box });
    near({ x: (after[0].x + after[3].x) / 2, y: (after[0].y + after[3].y) / 2 }, leftMidBefore);
  });
});

describe('rotateSvgImageTo', () => {
  it('measures clockwise from straight up (knob convention)', () => {
    expect(rotateSvgImageTo(base(), { x: 0, y: -1 }, false)).toBeCloseTo(0, 6);
    expect(rotateSvgImageTo(base(), { x: 1, y: 0 }, false)).toBeCloseTo(90, 6);
    expect(rotateSvgImageTo(base(), { x: 0, y: 1 }, false)).toBeCloseTo(180, 6);
  });
  it('snaps to 22.5° only when shift is held', () => {
    // Pointer 30° clockwise from up: direction (sin30, -cos30).
    const p = { x: Math.sin((30 * Math.PI) / 180), y: -Math.cos((30 * Math.PI) / 180) };
    expect(rotateSvgImageTo(base(), p, false)).toBeCloseTo(30, 6);
    expect(rotateSvgImageTo(base(), p, true)).toBe(22.5);
  });
});

describe('svgImageSnapAnchor', () => {
  it('is the highest-then-leftmost ROTATED world corner', () => {
    // 90°: corners TL=(30,-50), TR=(30,50), BR=(-30,50), BL=(-30,-50).
    // Highest (min y) = -50 at TL and BL; leftmost wins → BL=(-30,-50).
    near(svgImageSnapAnchor(base({ rotation: 90 })), { x: -30, y: -50 });
  });
});

describe('svgImageDimensionGuides', () => {
  it('rides the top edge with the width and the right edge with the height', () => {
    const g = svgImageDimensionGuides({ x: 10, y: 0, width: 120, height: 60 }, 0);
    expect(g).toHaveLength(2);
    // Width: TL → TR, so the flipped perpendicular puts the label ABOVE.
    near(g[0].from, { x: -50, y: -30 });
    near(g[0].to, { x: 70, y: -30 });
    expect(g[0].label).toBe('120.0');
    // Height: BR → TR (upward), whose unflipped perpendicular points east.
    near(g[1].from, { x: 70, y: 30 });
    near(g[1].to, { x: 70, y: -30 });
    expect(g[1].label).toBe('60.0');
    for (const d of g) {
      expect(d.quiet).toBe(true);
      expect(d.labelOnly).toBe(true);
    }
  });

  it('swaps to the opposite edges on a rotated image so the labels stay OUTSIDE', () => {
    // At 90° the local top edge sits on the screen's RIGHT and its screen-up
    // label would land inside the box — so the width readout switches to the
    // local bottom edge (now the screen-left edge, label pointing west), and
    // the height to the local left edge (now the screen-top edge, label above).
    // Corners at 90°: TL=(30,-50), TR=(30,50), BR=(-30,50), BL=(-30,-50).
    const g = svgImageDimensionGuides({ x: 0, y: 0, width: 100, height: 60 }, 90);
    near(g[0].from, { x: -30, y: -50 }); // BL
    near(g[0].to, { x: -30, y: 50 }); // BR
    expect(g[0].label).toBe('100.0');
    near(g[1].from, { x: -30, y: -50 }); // BL
    near(g[1].to, { x: 30, y: -50 }); // TL
    expect(g[1].label).toBe('60.0');
  });

  it('lands every label outside the box at any rotation', () => {
    // The side SnapGuides will place each label on (guideLabelSide — the
    // shared rule) must point AWAY from the image center, both guides, all
    // octants.
    for (const rotation of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const g of svgImageDimensionGuides({ x: 7, y: -3, width: 100, height: 60 }, rotation)) {
        const mid = midpoint(g.from, g.to);
        const outward = sub(mid, { x: 7, y: -3 });
        expect(dot(guideLabelSide(g.from, g.to), outward)).toBeGreaterThan(0);
      }
    }
  });
});
