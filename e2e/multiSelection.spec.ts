import { test, expect, type Page } from '@playwright/test';
import { clickAtWithModifiers, fourInLine, seedAndOpen, stationCenter } from './fixtures';

async function stationWorldPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  // Read world coords from the bg <g>'s transform attribute, which always
  // reflects the live render state (vs. localStorage, which lags writes).
  return await page.evaluate((sid) => {
    const el = document.querySelector(`[data-station-id="${sid}"]`);
    if (!el) throw new Error(`station ${sid} not in DOM`);
    const t = el.getAttribute('transform') ?? '';
    const m = t.match(/translate\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
    if (!m) throw new Error(`could not parse transform "${t}"`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }, id);
}

test.describe('multi-station selection', () => {
  test('shift-click toggles stations into and out of the set', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const c = await stationCenter(page, 'C');

    await page.mouse.click(a.x, a.y);
    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toHaveCount(0);

    await clickAtWithModifiers(page, c, ['Shift']);
    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toBeVisible();

    // Shift-click C again toggles it off; A remains.
    await clickAtWithModifiers(page, c, ['Shift']);
    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toHaveCount(0);
  });

  test('inspector hides when more than one station is selected', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const c = await stationCenter(page, 'C');

    await page.mouse.click(a.x, a.y);
    // Inspector renders inline inside [data-station-row="A"] when expanded.
    await expect(page.locator('[data-station-row="A"] .inline-editor')).toBeVisible();

    await clickAtWithModifiers(page, c, ['Shift']);
    // Multi-select: no inline editor anywhere in the sidebar.
    await expect(page.locator('.inline-editor')).toHaveCount(0);

    // Both rows still marked selected in the list.
    await expect(page.locator('[data-station-row="A"] .list-row.selected')).toBeVisible();
    await expect(page.locator('[data-station-row="C"] .list-row.selected')).toBeVisible();

    // Shift-click C off → back to single selection, inspector returns.
    await clickAtWithModifiers(page, c, ['Shift']);
    await expect(page.locator('[data-station-row="A"] .inline-editor')).toBeVisible();
  });

  test('ctrl+shift+click extends selection along a shared line', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const d = await stationCenter(page, 'D');

    // Click A (single selection), then ctrl+shift+click D → all stations
    // between A and D (B, C, D) join the selection. A remains selected.
    await page.mouse.click(a.x, a.y);
    await clickAtWithModifiers(page, d, ['Control', 'Shift']);

    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="B"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="D"]')).toBeVisible();
  });

  test('ctrl+shift+click on a station with no shared line is a no-op', async ({ page }) => {
    // Add an isolated station E (no line membership) to the seed.
    const seed = {
      ...fourInLine,
      stations: [...fourInLine.stations, { id: 'E', name: 'E', x: 0, y: 200, stops: [] }],
    };
    await seedAndOpen(page, seed);

    const a = await stationCenter(page, 'A');
    const e = await stationCenter(page, 'E');

    await page.mouse.click(a.x, a.y);
    await clickAtWithModifiers(page, e, ['Control', 'Shift']);

    // Selection unchanged: only A.
    await expect(page.locator('[data-station-wash]')).toHaveCount(1);
    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
  });

  test('group drag: dragging one selected station moves all selected by the same delta', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const b = await stationCenter(page, 'B');
    const c = await stationCenter(page, 'C');

    // Build a 3-station selection [A, B, C]; D stays unselected.
    await page.mouse.click(a.x, a.y);
    await clickAtWithModifiers(page, b, ['Shift']);
    await clickAtWithModifiers(page, c, ['Shift']);
    await expect(page.locator('[data-station-wash]')).toHaveCount(3);

    const before = {
      A: await stationWorldPos(page, 'A'),
      B: await stationWorldPos(page, 'B'),
      C: await stationWorldPos(page, 'C'),
      D: await stationWorldPos(page, 'D'),
    };

    // Drag B by ~50 page pixels to the right (which equals 50 world units
    // at zoom=1). Hold shift to bypass snap so the delta is exact.
    await page.keyboard.down('Shift');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    // Several intermediate moves so the drag is detected (>4px threshold).
    await page.mouse.move(b.x + 10, b.y, { steps: 2 });
    await page.mouse.move(b.x + 50, b.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const after = {
      A: await stationWorldPos(page, 'A'),
      B: await stationWorldPos(page, 'B'),
      C: await stationWorldPos(page, 'C'),
      D: await stationWorldPos(page, 'D'),
    };

    const dxA = after.A.x - before.A.x;
    const dxB = after.B.x - before.B.x;
    const dxC = after.C.x - before.C.x;
    const dxD = after.D.x - before.D.x;

    // All three selected stations move by the same delta.
    expect(dxA).toBeCloseTo(dxB, 1);
    expect(dxC).toBeCloseTo(dxB, 1);
    // Move actually happened.
    expect(Math.abs(dxB)).toBeGreaterThan(20);
    // D (unselected) didn't move.
    expect(dxD).toBeCloseTo(0, 1);

    // One Ctrl-Z reverts the entire group move.
    await page.keyboard.press('Control+z');
    const reverted = {
      A: await stationWorldPos(page, 'A'),
      B: await stationWorldPos(page, 'B'),
      C: await stationWorldPos(page, 'C'),
    };
    expect(reverted.A.x).toBeCloseTo(before.A.x, 1);
    expect(reverted.B.x).toBeCloseTo(before.B.x, 1);
    expect(reverted.C.x).toBeCloseTo(before.C.x, 1);
  });

  test('rect-select on empty canvas selects every station inside', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const c = await stationCenter(page, 'C');
    // Drag a rectangle from above-left of A to below-right of C. Stations
    // sit at world y=0 so picking page y values 50px above and below gives
    // a rect that encloses A, B, and C but not D.
    const startX = a.x - 30;
    const startY = a.y - 50;
    const endX = c.x + 20;
    const endY = c.y + 50;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY, { steps: 2 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="B"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="D"]')).toHaveCount(0);
  });

  test('shift+rect-select adds to the existing selection', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const d = await stationCenter(page, 'D');

    // First, single-select D.
    await page.mouse.click(d.x, d.y);
    await expect(page.locator('[data-station-wash="D"]')).toBeVisible();

    // Then shift+rect-drag over A and B.
    const b = await stationCenter(page, 'B');
    const startX = a.x - 30;
    const startY = a.y - 50;
    const endX = b.x + 20;
    const endY = b.y + 50;

    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY, { steps: 2 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await expect(page.locator('[data-station-wash="A"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="B"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toHaveCount(0);
    await expect(page.locator('[data-station-wash="D"]')).toBeVisible();
  });

  test('right-click on a member of a multi-selection rotates the whole group rigidly', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    const c = await stationCenter(page, 'C');

    // Select A and C. (B and D stay unselected.)
    await page.mouse.click(a.x, a.y);
    await clickAtWithModifiers(page, c, ['Shift']);

    const beforeA = await stationWorldPos(page, 'A');
    const beforeC = await stationWorldPos(page, 'C');
    const beforeB = await stationWorldPos(page, 'B');
    const beforeD = await stationWorldPos(page, 'D');
    const distBefore = Math.hypot(beforeA.x - beforeC.x, beforeA.y - beforeC.y);

    // Right-click on A — A is the pivot.
    await page.mouse.click(a.x, a.y, { button: 'right' });

    const afterA = await stationWorldPos(page, 'A');
    const afterC = await stationWorldPos(page, 'C');
    const afterB = await stationWorldPos(page, 'B');
    const afterD = await stationWorldPos(page, 'D');

    // Pivot didn't move.
    expect(afterA.x).toBeCloseTo(beforeA.x, 1);
    expect(afterA.y).toBeCloseTo(beforeA.y, 1);

    // C orbited 45° clockwise around A: distance preserved.
    const distAfter = Math.hypot(afterA.x - afterC.x, afterA.y - afterC.y);
    expect(distAfter).toBeCloseTo(distBefore, 1);

    // C's world position is rotated 45° CW around A. With C originally
    // east of A (delta = (+400, 0)), it should now be SE: x and y deltas
    // are both ~+283.
    const SQRT2_2 = Math.SQRT2 / 2;
    const expCdx = (beforeC.x - beforeA.x) * SQRT2_2 - (beforeC.y - beforeA.y) * SQRT2_2;
    const expCdy = (beforeC.x - beforeA.x) * SQRT2_2 + (beforeC.y - beforeA.y) * SQRT2_2;
    expect(afterC.x - afterA.x).toBeCloseTo(expCdx, 1);
    expect(afterC.y - afterA.y).toBeCloseTo(expCdy, 1);

    // Unselected stations (B, D) didn't move.
    expect(afterB.x).toBeCloseTo(beforeB.x, 1);
    expect(afterB.y).toBeCloseTo(beforeB.y, 1);
    expect(afterD.x).toBeCloseTo(beforeD.x, 1);
    expect(afterD.y).toBeCloseTo(beforeD.y, 1);
  });

  test('ctrl+shift+rect-select toggles (xor) hits with the existing selection', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Pre-select A and C (so a rect over A+B will toggle A off, leaving
    // {C, B} after the gesture).
    const a = await stationCenter(page, 'A');
    const b = await stationCenter(page, 'B');
    const c = await stationCenter(page, 'C');
    await page.mouse.click(a.x, a.y);
    await clickAtWithModifiers(page, c, ['Shift']);

    const startX = a.x - 30;
    const startY = a.y - 50;
    const endX = b.x + 20;
    const endY = b.y + 50;

    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY, { steps: 2 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');

    await expect(page.locator('[data-station-wash="A"]')).toHaveCount(0);
    await expect(page.locator('[data-station-wash="B"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="C"]')).toBeVisible();
    await expect(page.locator('[data-station-wash="D"]')).toHaveCount(0);
  });
});
