import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, fourInLine } from './fixtures';

/**
 * The map library against real Chromium: real IndexedDB and real rasterization,
 * neither of which exists under jsdom. This is the only proof that a thumbnail
 * is a picture rather than a string.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.removeItem('vignelli-map-doc-v1');
    localStorage.removeItem('massimo-library-current');
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('massimo-library');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });
});

const saveToLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Save' }).click();
  await page.getByRole('menuitem', { name: 'To library' }).click();
  await expect(page.getByRole('alert')).toContainText('Saved to library');
};

/** A library row by name — scoped, since the toolbar's name button matches too. */
const mapRow = (page: Page, name: string) => page.locator('.map-row').filter({ hasText: name });

const openLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Load' }).click();
  await page.getByRole('menuitem', { name: 'From library…' }).click();
  await expect(page.getByRole('dialog', { name: 'Map library' })).toBeVisible();
};

const clickNew = async (page: Page) => {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
};

test('a saved map survives a Clear and comes back from the library', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await expect(page.locator('[data-station-id]')).toHaveCount(4);
  await saveToLibrary(page);

  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Clear' }).click();
  // MANDATORY. Without proving the canvas is actually empty first, the doc just
  // rehydrates from the persist slot and the final assertion cannot fail.
  await expect(page.locator('[data-station-id]')).toHaveCount(0);

  await openLibrary(page);
  await mapRow(page, 'Untitled map').first().click();
  await page.getByRole('button', { name: /Open revision/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Map library' })).toBeHidden();
  await expect(page.locator('[data-station-id]')).toHaveCount(4);
});

test('a revision thumbnail is a real raster within the 240×180 box', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await saveToLibrary(page);
  await openLibrary(page);
  await mapRow(page, 'Untitled map').first().click();

  const thumb = page.locator('.map-library-revisions img.map-thumb').first();
  await expect(thumb).toBeVisible();
  const size = await thumb.evaluate((img: HTMLImageElement) => ({
    w: img.naturalWidth,
    h: img.naturalHeight,
  }));
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);
  expect(size.w).toBeLessThanOrEqual(240);
  expect(size.h).toBeLessThanOrEqual(180);
});

// Three legs, because "two saves → New → a third tagged auto" is self-
// contradictory: New auto-saves the SAME unmutated doc, which is byte-identical
// to revision 2, so the dedup gate correctly skips and no third revision can
// ever appear.
test.describe('revision tagging', () => {
  test('an explicit save is never deduped', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await saveToLibrary(page);
    await saveToLibrary(page);
    await openLibrary(page);
    await mapRow(page, 'Untitled map').first().click();
    await expect(page.locator('.revision-row')).toHaveCount(2);
    await expect(page.locator('.revision-source')).toHaveText(['user', 'user']);
  });

  test('New writes nothing when the doc has not changed since its save', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await saveToLibrary(page);
    await saveToLibrary(page);
    await clickNew(page);
    await expect(page.locator('[data-station-id]')).toHaveCount(0);

    await openLibrary(page);
    await mapRow(page, 'Untitled map').first().click();
    await expect(page.locator('.revision-row')).toHaveCount(2);
  });

  test('New auto-saves once the doc has changed', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await saveToLibrary(page);
    // Renaming is the smallest edit that is unambiguously a doc change. The name
    // field is a button until it's clicked.
    await page.getByRole('button', { name: 'Untitled map' }).click();
    await page.getByRole('textbox', { name: 'Map name' }).fill('Edited Map');
    await page.getByRole('textbox', { name: 'Map name' }).press('Enter');
    await expect(page.getByRole('button', { name: 'Edited Map' })).toBeVisible();
    await clickNew(page);
    await expect(page.locator('[data-station-id]')).toHaveCount(0);

    await openLibrary(page);
    await mapRow(page, 'Edited Map').first().click();
    await expect(page.locator('.revision-row')).toHaveCount(2);
    await expect(page.locator('.revision-source')).toHaveText(['auto', 'user']);
  });
});

test('two maps may share a name', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await saveToLibrary(page);
  // New mints a fresh library id, so the next save under the same title is a
  // second MAP rather than a second revision of the first. Names do not key the
  // library — ids do.
  await clickNew(page);
  await seedAndOpen(page, fourInLine); // content again, still on the new id
  await saveToLibrary(page);

  await openLibrary(page);
  await expect(page.locator('.map-row')).toHaveCount(2);
  await expect(page.locator('.map-row strong')).toHaveText(['Untitled map', 'Untitled map']);
});
