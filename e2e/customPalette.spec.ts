import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, type Seed } from './fixtures';

// One line so the inspector (with the color palette) is reachable by clicking
// its stripe — mirrors lineRepaint.spec.
const twoStop: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
};

// The "frrf" custom-palette format: only `human` colors are used; `line` becomes
// the swatch name; `cat`/`locked` are ignored.
const FRRF = JSON.stringify({
  name: 'frrf',
  colors: [
    { line: 1, human: '#c1272d', cat: '#777151', locked: false },
    { line: 2, human: '#0061a8', cat: '#415c82', locked: false },
    { line: 3, human: '#1f9e57', cat: '#8a8672', locked: false },
    { line: 4, human: '#e58a00', cat: '#b1a871', locked: false },
    { line: 5, human: '#6a3d9a', cat: '#405677', locked: false },
  ],
});

const openManager = (page: Page) =>
  page.getByRole('button', { name: 'Manage palettes' }).click();

const closeManager = (page: Page) => page.getByRole('button', { name: 'Close palettes' }).click();

const loadFrrf = (page: Page) =>
  page.getByLabel('Load palette file').setInputFiles({
    name: 'frrf.json',
    mimeType: 'application/json',
    buffer: Buffer.from(FRRF),
  });

const libraryRow = (page: Page, name: string) =>
  page.locator('.palette-library .palette-row').filter({ hasText: name });
const mapRow = (page: Page, name: string) =>
  page.locator('.palette-in-map .palette-row').filter({ hasText: name });

test.describe('palette manager', () => {
  test('a loaded palette lands in the library AND the map, and both survive a reload', async ({
    page,
  }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);

    await expect(libraryRow(page, 'frrf')).toBeVisible();
    await expect(mapRow(page, 'frrf')).toBeVisible();
    await expect(mapRow(page, 'frrf').locator('.palette-strip > span')).toHaveCount(5);

    // The library is localStorage and the map's copy is in the persisted doc:
    // one reload exercises both rehydrate paths at once.
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await openManager(page);
    await expect(libraryRow(page, 'frrf')).toBeVisible();
    await expect(mapRow(page, 'frrf')).toBeVisible();
  });

  // The point of the map holding COPIES: a map opened on a machine that has
  // never seen the palette still paints with it.
  test('deleting from the library leaves the map’s copy painting', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);

    await libraryRow(page, 'frrf').getByRole('button', { name: 'Delete frrf' }).click();
    await page.getByRole('button', { name: 'Confirm deleting frrf' }).click();
    await expect(libraryRow(page, 'frrf')).toHaveCount(0);
    await expect(mapRow(page, 'frrf')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await openManager(page);
    await expect(libraryRow(page, 'frrf')).toHaveCount(0);
    await expect(mapRow(page, 'frrf')).toBeVisible();
  });

  test('a palette in the map shows in the line color picker and repaints a line', async ({
    page,
  }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);
    await closeManager(page);

    // Select the line → inspector with the color palette.
    await page.locator('[data-band-stripe][data-line-id="L1"]').first().click({ force: true });
    await page.locator('.inspector').waitFor();

    // The frrf section is present; its first swatch hovers as the line name "1".
    // Exact match — substring would also catch MTA's "Red (1·2·3)".
    const swatch = page.locator('.inspector').getByTitle('1', { exact: true });
    await expect(swatch).toBeVisible();

    // Clicking it repaints the line with the custom color, live.
    await swatch.click();
    await expect(page.locator('[data-band-stripe][data-line-id="L1"]').first()).toHaveAttribute(
      'stroke',
      '#c1272d',
    );
  });

  test('removing a palette from the map takes its colors out of the picker', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);
    await mapRow(page, 'frrf').getByRole('button', { name: 'Remove frrf from the map' }).click();
    await expect(mapRow(page, 'frrf')).toHaveCount(0);
    await closeManager(page);

    await page.locator('[data-band-stripe][data-line-id="L1"]').first().click({ force: true });
    await page.locator('.inspector').waitFor();
    await expect(page.locator('.inspector').getByTitle('1', { exact: true })).toHaveCount(0);
  });
});
