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

  it('places diagonally below-left of the item when there is room', () => {
    // Diagonal candidate (390−14−248, 310+14) = (128,324) fits and by
    // construction clears the item — no clamping, no flip. Below-left keeps
    // the space right of the station — where work usually continues — clear,
    // and the diagonal keeps same-row neighbors (metro lines run
    // horizontally) clickable beside the open panel.
    expect(choosePopoverSpawn({ x0: 390, y0: 290, x1: 410, y1: 310 }, pop, host)).toEqual({
      x: 128,
      y: 324,
    });
  });

  it('a degenerate point rect gets the point+gap spawn mirrored to the left', () => {
    // (400−14−248, 300+14): the historical point+gap shape, left-handed.
    expect(choosePopoverSpawn({ x0: 400, y0: 300, x1: 400, y1: 300 }, pop, host)).toEqual({
      x: 138,
      y: 314,
    });
  });

  it('slides along the item bottom when the left edge clamps the diagonal', () => {
    // Diagonal (−222,254) clamps to (8,254): still below the item
    // ([40,100]×[200,240]) — 254 > 240 keeps it clear, no flip needed.
    expect(choosePopoverSpawn({ x0: 40, y0: 200, x1: 100, y1: 240 }, pop, host)).toEqual({
      x: 8,
      y: 254,
    });
  });

  it('slides up the left side when the bottom edge clamps the diagonal (bottom-right item)', () => {
    // Below-left diagonal (438,574) clamps to (438,344): the popover's right
    // edge 438+248 = 686 still clears the item's left edge 700, so the
    // clamped diagonal wins without a flip.
    expect(choosePopoverSpawn({ x0: 700, y0: 500, x1: 760, y1: 560 }, pop, host)).toEqual({
      x: 438,
      y: 344,
    });
  });

  it('flips above when clamping pushes the below diagonal into the item (bottom-left item)', () => {
    // Below-left diagonal (−162,574) clamps to (8,344) → overlaps the item
    // ([100,160]×[500,560]). Above-left diagonal: (8, 500−14−248) = (8,238)
    // clears it vertically.
    expect(choosePopoverSpawn({ x0: 100, y0: 500, x1: 160, y1: 560 }, pop, host)).toEqual({
      x: 8,
      y: 238,
    });
  });

  it('flips above for an item spanning the bottom of the view', () => {
    // The below-left diagonal clamps into the item band ([0,800]×[500,560]);
    // the above-left diagonal (x clamps to 8, y = 500−262 = 238) is
    // vertically clear.
    expect(choosePopoverSpawn({ x0: 0, y0: 500, x1: 800, y1: 560 }, pop, host)).toEqual({
      x: 8,
      y: 238,
    });
  });

  it('flips right when the whole left column is blocked', () => {
    // Item spans the left column ([0,100]×[0,600]): every left/above/below
    // candidate clamps into it; the below-right diagonal (100+14, y clamps
    // to 344) is the first that clears.
    expect(choosePopoverSpawn({ x0: 0, y0: 0, x1: 100, y1: 600 }, pop, host)).toEqual({
      x: 114,
      y: 344,
    });
  });

  it('falls back to the clamped diagonal when every side overlaps (item fills the view)', () => {
    // No side can clear a viewport-covering item; fully-visible wins and the
    // popover sits at the clamped first candidate: (−362,714) → (8,344).
    expect(choosePopoverSpawn({ x0: -100, y0: -100, x1: 900, y1: 700 }, pop, host)).toEqual({
      x: 8,
      y: 344,
    });
  });

  it('clamps an off-screen item spawn into the host (no overlap possible)', () => {
    // Item projects far right of the host: diagonal (5128,324) clamps to
    // (544,324); the item rect is entirely off-host so nothing overlaps.
    expect(choosePopoverSpawn({ x0: 5390, y0: 290, x1: 5410, y1: 310 }, pop, host)).toEqual({
      x: 544,
      y: 324,
    });
  });

  it('respects a non-square footprint per axis', () => {
    // Station-sized popover (320×560): diagonal x = 390−14−320 = 56, y clamps
    // to 600−560−8 = 32; [56,376] still clears the item horizontally.
    expect(
      choosePopoverSpawn({ x0: 390, y0: 290, x1: 410, y1: 310 }, { w: 320, h: 560 }, host),
    ).toEqual({ x: 56, y: 32 });
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
    // Every left/above/below candidate pins into the item band; the
    // below-right diagonal (234, y pinned to 8) clears it horizontally.
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
