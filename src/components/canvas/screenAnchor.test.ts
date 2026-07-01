import { describe, it, expect } from 'vitest';
import { clampPopoverAnchor, projectToScreen, screenDeltaToWorld } from './screenAnchor';

// zoom = size.w / vbW = 2 here (vbW 400 over an 800px host).
const view = { vbX: 100, vbY: 50, vbW: 400, vbH: 300, size: { w: 800, h: 600 } };

describe('projectToScreen', () => {
  it('maps the viewBox origin to the screen origin and scales by zoom', () => {
    expect(projectToScreen({ x: 100, y: 50 }, view)).toEqual({ x: 0, y: 0 });
    // 10 world units → 20 screen px at zoom 2.
    expect(projectToScreen({ x: 110, y: 60 }, view)).toEqual({ x: 20, y: 20 });
  });
});

describe('screenDeltaToWorld', () => {
  it('is the scaling inverse of projectToScreen (translation drops out)', () => {
    // 20 screen px → 10 world units at zoom 2; vbX/vbY are irrelevant to a delta.
    expect(screenDeltaToWorld({ x: 20, y: 20 }, view)).toEqual({ x: 10, y: 10 });
  });

  it('round-trips a world delta through projectToScreen at any zoom', () => {
    const worldDelta = { x: 7, y: -3 };
    const base = { x: 100, y: 50 };
    const screenDelta = {
      x:
        projectToScreen({ x: base.x + worldDelta.x, y: base.y }, view).x -
        projectToScreen(base, view).x,
      y:
        projectToScreen({ x: base.x, y: base.y + worldDelta.y }, view).y -
        projectToScreen(base, view).y,
    };
    const back = screenDeltaToWorld(screenDelta, view);
    expect(back.x).toBeCloseTo(worldDelta.x, 10);
    expect(back.y).toBeCloseTo(worldDelta.y, 10);
  });
});

describe('clampPopoverAnchor', () => {
  const size = { w: 800, h: 600 };

  it('leaves an in-bounds anchor untouched', () => {
    expect(clampPopoverAnchor({ x: 200, y: 150 }, size)).toEqual({ x: 200, y: 150 });
  });

  it('clamps to the margin on the low side', () => {
    expect(clampPopoverAnchor({ x: -40, y: 2 }, size)).toEqual({ x: 8, y: 8 });
  });

  it('clamps so the popover footprint stays inside on the high side', () => {
    // 800 − 248 − 8 = 544; 600 − 248 − 8 = 344.
    expect(clampPopoverAnchor({ x: 790, y: 590 }, size)).toEqual({ x: 544, y: 344 });
  });

  it('skips an axis whose host extent is too small to fit the popover at all', () => {
    // 100px host (e.g. the polygon-popover test view, or a first zero-size
    // paint): no placement helps, so the anchor passes through unchanged.
    expect(clampPopoverAnchor({ x: 14, y: 590 }, { w: 100, h: 600 })).toEqual({ x: 14, y: 344 });
    expect(clampPopoverAnchor({ x: 14, y: 14 }, { w: 0, h: 0 })).toEqual({ x: 14, y: 14 });
  });
});
