import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter } from './fixtures';

async function startAddLine(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Line', exact: true }).click();
  // Banner is the visible signal that append mode is engaged.
  await expect(page.locator('.append-banner')).toBeVisible();
}

async function readLines(page: Page): Promise<{ id: string; stations: string[] }[]> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return [];
    const lines = JSON.parse(raw).state.lines as Record<
      string,
      { id: string; stations: string[] }
    >;
    return Object.values(lines).map((l) => ({ id: l.id, stations: l.stations }));
  });
}

test.describe('Add → Line cancel', () => {
  test('right-click cancels too, garbage-collecting the empty line', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await startAddLine(page);
    // Right-click is the mouse-only exit for Edit Stops — on a freshly
    // created placeholder line it cancels exactly like Esc, rolling the
    // empty line back.
    await page.mouse.click(700, 400, { button: 'right' });
    await expect(page.locator('.append-banner')).toBeHidden();
    expect(await readLines(page)).toEqual([]);
  });

  test('Esc cancels without creating an empty line', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await startAddLine(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.append-banner')).toBeHidden();
    expect(await readLines(page)).toEqual([]);
  });

  test('clicking empty canvas cancels without creating an empty line', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await startAddLine(page);
    await page.mouse.click(700, 400);
    await expect(page.locator('.append-banner')).toBeHidden();
    expect(await readLines(page)).toEqual([]);
  });

  test('line with stations is preserved on cancel (regression)', async ({ page }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'A', name: 'A', x: 0, y: 0, stops: [] }],
      lines: [],
    });
    await startAddLine(page);
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Escape');
    const lines = await readLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0].stations).toEqual(['A']);
  });
});
