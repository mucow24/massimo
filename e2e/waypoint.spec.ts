import { test, expect } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine, toggleViewLayer } from './fixtures';

test.describe('Waypoint toggle', () => {
  test('toggling Waypoint on B hides its bullets but leaves it selectable; WP pill in sidebar', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);

    // Baseline: B has a visible black dot, and the sidebar has no WP pill.
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="circle"]'),
    ).toBeVisible();
    await expect(page.locator('.wp-pill')).toHaveCount(0);

    // Toggle on.
    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();

    // Glyph gone for B.
    await expect(page.locator('[data-stop-station="B"][data-stop-shape]')).toHaveCount(0);
    // Cells hit area still in DOM so the station stays clickable.
    await expect(page.locator('[data-station-id="B"]')).toBeVisible();
    // Sibling A's glyph is unaffected.
    await expect(
      page.locator('[data-stop-station="A"][data-stop-shape="circle"]'),
    ).toBeVisible();
    // WP pill present in the sidebar.
    await expect(page.locator('.wp-pill')).toBeVisible();
  });

  test('toggle off restores the prior dot shape (non-destructive)', async ({ page }) => {
    await seedAndOpen(page, fourInLine, { stopDotLibrary: true });
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);

    // Pick a non-default shape for B's L1 stop first.
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.locator('[data-cell-kind="stop"][data-line-id="L1"]').click();
    await page.getByRole('button', { name: 'Stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black diamond' }).click();
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="diamond"]'),
    ).toBeVisible();

    // Toggle waypoint on, then off.
    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();
    await expect(page.locator('[data-stop-station="B"][data-stop-shape]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();

    // Diamond shape restored.
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="diamond"]'),
    ).toBeVisible();
  });

  test('Ctrl+Z undoes a waypoint toggle', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);

    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();
    await expect(page.locator('.wp-pill')).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(page.locator('.wp-pill')).toHaveCount(0);
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="circle"]'),
    ).toBeVisible();
  });

  test('Show-waypoints toolbar toggle reveals a hidden waypoint and its WP lozenge', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);

    // Mark B as a waypoint — its glyph disappears while the overlay is off.
    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();
    await expect(page.locator('[data-stop-station="B"][data-stop-shape]')).toHaveCount(0);

    // Turn on Show-waypoints from the toolbar: B's stop returns as a
    // black-stroke/white-fill dot, and a "WP" lozenge is painted before its name.
    await toggleViewLayer(page, 'Waypoints');
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="circle"]'),
    ).toBeVisible();
    await expect(page.locator('[data-waypoint-lozenge]')).toHaveCount(1);

    // Turn it back off: B is hidden again (the overlay is non-destructive).
    await toggleViewLayer(page, 'Waypoints');
    await expect(page.locator('[data-stop-station="B"][data-stop-shape]')).toHaveCount(0);
    await expect(page.locator('[data-waypoint-lozenge]')).toHaveCount(0);
  });
});
