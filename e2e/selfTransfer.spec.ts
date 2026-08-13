import { test, expect } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

// The station popover's Xfer picker is the only way to put a SELF-transfer on a
// stop dot — a transfer with both ends on the one dot, which paints as a disc
// that rounds the stop off into a thick transfer bar. Unit tests pin the
// transform, the store contract and the row; what only a browser shows is that
// the disc really lands on the map, survives a reload, and goes away again.

test.describe('Self transfer — the stop row Xfer picker', () => {
  const disc = (page: Parameters<typeof stationCenter>[0]) =>
    page.locator('circle[data-transfer-id]');

  test('picking a style paints a disc on the dot; None removes it', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await expect(disc(page)).toHaveCount(0);

    await page.getByRole('combobox', { name: /^Transfer \(line/ }).click();
    await page.getByRole('option', { name: 'Default' }).click();

    // The factory transfer style is 2px black, so the disc is r 1 — tiny, and
    // wholly under A's own stop dot. That it reaches the map's SVG at all is
    // the check; being hard to SEE there is exactly why the picker exists.
    await expect(disc(page)).toHaveCount(1);
    await expect(disc(page)).toHaveAttribute('r', '1');

    await page.getByRole('combobox', { name: /^Transfer \(line/ }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(disc(page)).toHaveCount(0);
  });

  test('it survives a reload, and the picker still knows it is there', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('combobox', { name: /^Transfer \(line/ }).click();
    await page.getByRole('option', { name: 'Default' }).click();
    await expect(disc(page)).toHaveCount(1);

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(disc(page)).toHaveCount(1);

    // Re-select and re-open: the picker offers None as a live way out, which is
    // the whole point of routing this through a menu rather than the canvas.
    const a2 = await stationCenter(page, 'A');
    await page.mouse.click(a2.x, a2.y);
    await page.getByRole('combobox', { name: /^Transfer \(line/ }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(disc(page)).toHaveCount(0);
  });
});
