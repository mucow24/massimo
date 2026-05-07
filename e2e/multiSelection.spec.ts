import { test, expect } from '@playwright/test';
import { clickAtWithModifiers, fourInLine, seedAndOpen, stationCenter } from './fixtures';

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
});
