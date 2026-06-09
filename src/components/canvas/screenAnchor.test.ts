import { describe, it, expect } from 'vitest';
import { projectToScreen, screenDeltaToWorld } from './screenAnchor';

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
