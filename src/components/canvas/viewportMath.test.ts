import { describe, it, expect } from 'vitest';
import {
  computeWheelZoom,
  liveProjection,
  overdrawnViewBox,
  panFromDelta,
  panFromWheel,
  screenToWorld,
  viewBoxFor,
} from './viewportMath';

const SIZE = { w: 800, h: 600 };
// Host pinned at the screen origin, so screen coords == client coords.
const RECT = { left: 0, top: 0, width: 800, height: 600 };

describe('viewBoxFor', () => {
  it('centers the viewBox on the viewport and scales the extent by 1/zoom', () => {
    expect(viewBoxFor({ x: 0, y: 0, zoom: 1 }, SIZE)).toEqual({
      vbX: -400,
      vbY: -300,
      vbW: 800,
      vbH: 600,
    });
  });

  it('shrinks the world extent as zoom rises', () => {
    expect(viewBoxFor({ x: 0, y: 0, zoom: 2 }, SIZE)).toEqual({
      vbX: -200,
      vbY: -150,
      vbW: 400,
      vbH: 300,
    });
  });
});

describe('overdrawnViewBox', () => {
  it('grows the box one viewport-width/height in every direction (3× tile)', () => {
    expect(overdrawnViewBox({ vbX: 10, vbY: 20, vbW: 100, vbH: 60 })).toEqual({
      vbX: -90,
      vbY: -40,
      vbW: 300,
      vbH: 180,
    });
  });

  it('stays centered on the original box', () => {
    const vb = { vbX: -400, vbY: -300, vbW: 800, vbH: 600 };
    const od = overdrawnViewBox(vb);
    expect(od.vbX + od.vbW / 2).toBe(vb.vbX + vb.vbW / 2);
    expect(od.vbY + od.vbH / 2).toBe(vb.vbY + vb.vbH / 2);
  });
});

describe('liveProjection', () => {
  const committed = { vbX: -400, vbY: -300, vbW: 800, vbH: 600, size: SIZE };

  it('returns the committed projection unchanged between gestures (pending null)', () => {
    expect(liveProjection(committed, null)).toBe(committed);
  });

  it('reprojects through the in-flight viewport while a gesture is pending', () => {
    // A pan that moved the center to (-50,-30) at zoom 1 → vb origin (-450,-330).
    expect(liveProjection(committed, { x: -50, y: -30, zoom: 1 })).toEqual({
      vbX: -450,
      vbY: -330,
      vbW: 800,
      vbH: 600,
      size: SIZE,
    });
  });

  it('keeps the committed host size when the pending viewport zooms', () => {
    const live = liveProjection(committed, { x: 0, y: 0, zoom: 2 });
    expect(live.size).toBe(SIZE);
    // zoom 2 halves the world extent (size unchanged).
    expect({ vbW: live.vbW, vbH: live.vbH }).toEqual({ vbW: 400, vbH: 300 });
  });
});

describe('screenToWorld', () => {
  it('maps the screen center to the viewport center', () => {
    const vb = viewBoxFor({ x: 0, y: 0, zoom: 1 }, SIZE);
    expect(screenToWorld({ x: 400, y: 300 }, vb, RECT)).toEqual({ x: 0, y: 0 });
  });

  it('subtracts the rect offset so a non-origin host still maps correctly', () => {
    const vb = viewBoxFor({ x: 0, y: 0, zoom: 1 }, SIZE);
    const rect = { left: 100, top: 50, width: 800, height: 600 };
    // Client (500,350) is host-local (400,300) → the host center → world origin.
    expect(screenToWorld({ x: 500, y: 350 }, vb, rect)).toEqual({ x: 0, y: 0 });
  });
});

describe('computeWheelZoom', () => {
  it('zooms in on a negative deltaY by exp(-deltaY*0.01) — 1:1 with a trackpad pinch', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, -10);
    expect(next.zoom).toBeCloseTo(Math.exp(0.1), 5);
  });

  it('clamps one event to ±20 so a discrete mouse-wheel notch (±100) steps ~22%', () => {
    const notchIn = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, -100);
    expect(notchIn.zoom).toBeCloseTo(Math.exp(0.2), 5);
    const notchOut = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, 100);
    expect(notchOut.zoom).toBeCloseTo(Math.exp(-0.2), 5);
  });

  it('keeps the world point under the cursor fixed across the zoom', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const cx = 600;
    const cy = 200;
    const before = screenToWorld({ x: cx, y: cy }, viewBoxFor(v, SIZE), RECT);
    const next = computeWheelZoom(v, SIZE, RECT, cx, cy, -12);
    const after = screenToWorld({ x: cx, y: cy }, viewBoxFor(next, SIZE), RECT);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('clamps zoom to a max of 64', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 60 }, SIZE, RECT, 400, 300, -100);
    expect(next.zoom).toBe(64);
  });

  it('clamps zoom to a min of 0.1', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 0.11 }, SIZE, RECT, 400, 300, 100);
    expect(next.zoom).toBe(0.1);
  });
});

describe('panFromWheel', () => {
  it('moves the viewport center along the scroll delta (positive deltaY reveals content below)', () => {
    expect(panFromWheel({ x: 0, y: 0, zoom: 1 }, 50, 30)).toEqual({ x: 50, y: 30, zoom: 1 });
  });

  it('shrinks the world-space pan as zoom rises', () => {
    expect(panFromWheel({ x: 10, y: 20, zoom: 2 }, 50, 30)).toEqual({ x: 35, y: 35, zoom: 2 });
  });
});

describe('panFromDelta', () => {
  it('moves the viewport center opposite the drag, scaled by 1/zoom', () => {
    const start = { mx: 100, my: 100, vx: 0, vy: 0 };
    expect(panFromDelta(start, 150, 130, 1)).toEqual({ x: -50, y: -30, zoom: 1 });
  });

  it('shrinks the world-space pan as zoom rises', () => {
    const start = { mx: 100, my: 100, vx: 0, vy: 0 };
    expect(panFromDelta(start, 150, 130, 2)).toEqual({ x: -25, y: -15, zoom: 2 });
  });
});
