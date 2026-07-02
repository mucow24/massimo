import { test, expect } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

// The picker lives in the StationInspector, which only renders for a
// single-station selection. Selecting a station is therefore a precondition
// for the picker to be on the page at all. Picking a stop in the on-canvas
// layout editor is also required: the picker writes to the selected stop.

test.describe('Stop shape picker — smoke', () => {
  test('selecting A, clicking its L1 stop, and picking "Filled black diamond" replaces only A\'s L1 dot', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Default: every station's stop is the filled-black circle.
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="circle"]'),
    ).toBeVisible();

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    // Enter the on-canvas layout editor and click A's L1 stop handle.
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();

    // Open picker, pick diamond.
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();

    // A's dot is now a polygon, tagged with the new base shape.
    const dot = page.locator('[data-stop-station="A"][data-stop-shape="diamond"]');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveJSProperty('tagName', 'polygon');
    await expect(dot).toHaveAttribute('fill', '#000000');

    // Sibling stations untouched.
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="circle"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-stop-station="C"][data-stop-shape="circle"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-stop-station="D"][data-stop-shape="circle"]'),
    ).toBeVisible();
  });
});

test.describe('Stop shape picker — coverage', () => {
  test('picker is absent when nothing is selected', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await expect(page.getByRole('button', { name: 'Stop shape' })).toHaveCount(0);
  });

  test('picker is present and ENABLED as soon as a station is selected (per-stop row)', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await expect(page.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  test('picker becomes enabled after clicking a stop in the layout editor', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();

    await expect(page.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  test('"None" leaves no glyph element at the targeted stop; line still routes through', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();
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
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="diamond"]'),
    ).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="circle"]'),
    ).toBeVisible();
  });

  test('shape persists across page reload (localStorage)', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();

    await page.reload();
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="diamond"]'),
    ).toBeVisible();
  });
});
