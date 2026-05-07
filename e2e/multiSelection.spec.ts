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
});
