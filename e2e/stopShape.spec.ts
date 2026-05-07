import { test, expect } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

// The picker lives in the StationInspector, which only renders for a
// single-station selection. Selecting a station is therefore a precondition
// for the picker to be on the page at all.

test.describe('Stop shape picker — smoke', () => {
  test('selecting A and picking "Filled black diamond" replaces A\'s dot with a <polygon>', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Default: A's stop is a circle.
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="filled-black"]'),
    ).toBeVisible();

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    // Inspector is now open; open the picker; pick the diamond.
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();

    // A's dot is now a polygon, tagged with the new shape.
    const dot = page.locator('[data-stop-station="A"][data-stop-shape="filled-black-diamond"]');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveJSProperty('tagName', 'polygon');
    await expect(dot).toHaveAttribute('fill', '#000');
  });
});

test.describe('Stop shape picker — coverage', () => {
  test('picker is absent when nothing is selected; appears once a station is selected', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);
    await expect(page.getByRole('button', { name: 'Stop shape' })).toHaveCount(0);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await expect(page.getByRole('button', { name: 'Stop shape' })).toBeVisible();
  });

  test('"None" leaves no glyph element; line still routes through the station', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'None' }).click();

    await expect(page.locator('[data-stop-station="B"][data-stop-shape]')).toHaveCount(0);
    // The bg hit area for B is still in the DOM, so labels and routing are intact.
    await expect(page.locator('[data-station-id="B"]')).toBeVisible();
  });

  test('Ctrl+Z undoes a shape change', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="filled-black-diamond"]'),
    ).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="filled-black"]'),
    ).toBeVisible();
  });

  test('shape persists across page reload (localStorage)', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();

    await page.reload();
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="filled-black-diamond"]'),
    ).toBeVisible();
  });
});
