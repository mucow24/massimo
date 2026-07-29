import { describe, it, expect } from 'vitest';
import {
  computeWheelZoom,
  fitViewport,
  overdrawnViewBox,
  panFromDelta,
  panSurfaceViewBox,
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

describe('panSurfaceViewBox', () => {
  it('grows the box half a viewport in every direction (2× per axis, same center)', () => {
    expect(panSurfaceViewBox({ vbX: 10, vbY: 20, vbW: 100, vbH: 60 })).toEqual({
      vbX: -40,
      vbY: -10,
      vbW: 200,
      vbH: 120,
    });
  });

  it('preserves the world-per-pixel scale of the visible box (2× window for a 2× element)', () => {
    // The svg element is 2× the host per axis (.canvas-pan-layer{inset:-50%}),
    // so doubling the window keeps zoom identical — the same world point lands
    // on the same screen pixel.
    const vb = viewBoxFor({ x: 30, y: -12, zoom: 2.5 }, { w: 800, h: 600 });
    const surface = panSurfaceViewBox(vb);
    expect(surface.vbW / (800 * 2)).toBeCloseTo(vb.vbW / 800, 12);
    expect(surface.vbH / (600 * 2)).toBeCloseTo(vb.vbH / 600, 12);
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
  it('zooms in on a negative deltaY by exp(-deltaY*0.0015)', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, -100);
    expect(next.zoom).toBeCloseTo(Math.exp(0.15), 5);
  });

  it('keeps the world point under the cursor fixed across the zoom', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const cx = 600;
    const cy = 200;
    const before = screenToWorld({ x: cx, y: cy }, viewBoxFor(v, SIZE), RECT);
    const next = computeWheelZoom(v, SIZE, RECT, cx, cy, -120);
    const after = screenToWorld({ x: cx, y: cy }, viewBoxFor(next, SIZE), RECT);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('clamps zoom to a max of 64', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, -100000);
    expect(next.zoom).toBe(64);
  });

  it('clamps zoom to a min of 0.1', () => {
    const next = computeWheelZoom({ x: 0, y: 0, zoom: 1 }, SIZE, RECT, 400, 300, 100000);
    expect(next.zoom).toBe(0.1);
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

describe('fitViewport', () => {
  it('centers on the bounds and holds natural scale when the map already fits', () => {
    expect(fitViewport({ x: 0, y: 0, w: 100, h: 100 }, { w: 1000, h: 1000 })).toEqual({
      x: 50,
      y: 50,
      zoom: 1,
    });
  });

  it('zooms out to fit a map larger than the viewport, limited by the tighter axis', () => {
    // No margin: width needs 1000/2000 = 0.5, height needs 800/1000 = 0.8 → 0.5.
    const vp = fitViewport(
      { x: 0, y: 0, w: 2000, h: 1000 },
      { w: 1000, h: 800 },
      { marginFrac: 0 },
    );
    expect(vp.x).toBe(1000);
    expect(vp.y).toBe(500);
    expect(vp.zoom).toBeCloseTo(0.5, 6);
  });

  it('applies the margin so content does not touch the viewport edge', () => {
    // 10% each side → 800px usable for a 1000-unit box → zoom 0.8.
    const vp = fitViewport(
      { x: 0, y: 0, w: 1000, h: 1000 },
      { w: 1000, h: 1000 },
      { marginFrac: 0.1, maxZoom: 100 },
    );
    expect(vp.zoom).toBeCloseTo(0.8, 6);
  });

  it('never zooms in past maxZoom (default 1) for a tiny map', () => {
    expect(fitViewport({ x: 5, y: 5, w: 10, h: 10 }, { w: 1000, h: 1000 })).toEqual({
      x: 10,
      y: 10,
      zoom: 1,
    });
  });

  it('honors an explicit maxZoom cap', () => {
    expect(
      fitViewport(
        { x: 0, y: 0, w: 10, h: 10 },
        { w: 1000, h: 1000 },
        { marginFrac: 0, maxZoom: 4 },
      ),
    ).toEqual({ x: 5, y: 5, zoom: 4 });
  });

  it('centers on a degenerate zero-size box at maxZoom', () => {
    expect(fitViewport({ x: 50, y: 50, w: 0, h: 0 }, { w: 1000, h: 1000 })).toEqual({
      x: 50,
      y: 50,
      zoom: 1,
    });
  });

  it('clamps out to the minimum zoom for an enormous map', () => {
    const vp = fitViewport({ x: 0, y: 0, w: 1e9, h: 1e9 }, { w: 1000, h: 1000 }, { marginFrac: 0 });
    expect(vp.zoom).toBeCloseTo(0.1, 6); // ZOOM_MIN
  });
});
