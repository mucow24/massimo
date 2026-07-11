import { describe, it, expect } from 'vitest';
import { choosePopoverSpawn, projectToScreen, screenDeltaToWorld } from './screenAnchor';

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

describe('choosePopoverSpawn', () => {
  // All cases: gap 14, margin 8. pop/host chosen so every expected value is
  // hand-computable: candidate = side of the item rect, clampAxis(v) =
  // max(8, min(v, extent − popExtent − 8)).
  const host = { w: 800, h: 600 };
  const pop = { w: 248, h: 248 };

  it('places diagonally below-right of the item when there is room', () => {
    // Diagonal candidate (410+14, 310+14) fits (672 ≤ 792, 572 ≤ 592) and by
    // construction clears the item — no clamping, no flip. The diagonal keeps
    // same-row neighbors (metro lines run horizontally) clickable beside the
    // open panel.
    expect(choosePopoverSpawn({ x0: 390, y0: 290, x1: 410, y1: 310 }, pop, host)).toEqual({
      x: 424,
      y: 324,
    });
  });

  it('a degenerate point rect reproduces the legacy point+gap spawn exactly', () => {
    expect(choosePopoverSpawn({ x0: 400, y0: 300, x1: 400, y1: 300 }, pop, host)).toEqual({
      x: 414,
      y: 314,
    });
  });

  it('slides along the item bottom when the right edge clamps the diagonal', () => {
    // Diagonal (774,254) clamps to (544,254): still below the item
    // ([700,760]×[200,240]) — 254 > 240 keeps it clear, no flip needed.
    expect(choosePopoverSpawn({ x0: 700, y0: 200, x1: 760, y1: 240 }, pop, host)).toEqual({
      x: 544,
      y: 254,
    });
  });

  it('flips left when right and below are both blocked (bottom-right item)', () => {
    // Right and below both clamp to (544,344) → overlap the item
    // ([700,760]×[500,560]). Left: (700−14−248, 500) = (438,500), y clamps to
    // 344 → [438,686] clears the item horizontally.
    expect(choosePopoverSpawn({ x0: 700, y0: 500, x1: 760, y1: 560 }, pop, host)).toEqual({
      x: 438,
      y: 344,
    });
  });

  it('flips above for an item spanning the bottom of the view', () => {
    // Right/below/left all clamp into the item band ([0,800]×[500,560]).
    // Above: (0, 500−14−248) = (0,238), x clamps to 8 — vertically clear.
    expect(choosePopoverSpawn({ x0: 0, y0: 500, x1: 800, y1: 560 }, pop, host)).toEqual({
      x: 8,
      y: 238,
    });
  });

  it('falls back to the clamped diagonal when every side overlaps (item fills the view)', () => {
    // No side can clear a viewport-covering item; fully-visible wins and the
    // popover sits at the clamped first candidate: (914,714) → (544,344).
    expect(choosePopoverSpawn({ x0: -100, y0: -100, x1: 900, y1: 700 }, pop, host)).toEqual({
      x: 544,
      y: 344,
    });
  });

  it('clamps an off-screen item spawn into the host (no overlap possible)', () => {
    // Item projects far right of the host: diagonal (5424,324) clamps to
    // (544,324); the item rect is entirely off-host so nothing overlaps.
    expect(choosePopoverSpawn({ x0: 5390, y0: 290, x1: 5410, y1: 310 }, pop, host)).toEqual({
      x: 544,
      y: 324,
    });
  });

  it('respects a non-square footprint per axis', () => {
    // Station-sized popover (320×560): diagonal keeps x 424, y clamps to
    // 600−560−8 = 32; [424,744] still clears the item horizontally.
    expect(
      choosePopoverSpawn({ x0: 390, y0: 290, x1: 410, y1: 310 }, { w: 320, h: 560 }, host),
    ).toEqual({ x: 424, y: 32 });
  });

  it('pins to the margin when the host cannot fit the popover at all', () => {
    // 100px-wide host, 248-wide popover: x always pins to the 8px margin so
    // the header corner stays visible. The diagonal's y (item bottom + gap)
    // keeps it clear of the item.
    expect(
      choosePopoverSpawn({ x0: 10, y0: 200, x1: 30, y1: 220 }, pop, { w: 100, h: 600 }),
    ).toEqual({ x: 8, y: 234 });
  });

  it('pins the y axis to the margin the same way (100px-tall host)', () => {
    // Diagonal (234,44): x fits, y pins to 8 (limit 100−248−8 < margin); the
    // popover clears the item horizontally.
    expect(
      choosePopoverSpawn({ x0: 200, y0: 10, x1: 220, y1: 30 }, pop, { w: 800, h: 100 }),
    ).toEqual({ x: 234, y: 8 });
  });

  it('pins both axes when the host is too small in both (fallback overlaps)', () => {
    // Every candidate pins to (8,8), which overlaps the item — the fallback
    // returns the pinned first candidate: header corner visible, best effort.
    expect(choosePopoverSpawn({ x0: 10, y0: 10, x1: 30, y1: 30 }, pop, { w: 100, h: 100 })).toEqual(
      { x: 8, y: 8 },
    );
  });
});
