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
    // Both keys: the pointer store adopts the legacy one on boot and only then
    // retires it, so a stale `massimo-library-current` would leak between tests.
    localStorage.removeItem('massimo-library-current');
    localStorage.removeItem('massimo-library-pointer');
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
  await page.getByRole('menuitem', { name: 'Save version' }).click();
  await expect(page.getByRole('alert')).toContainText(/Saved “.+” as v\d+/);
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

/**
 * The unrecoverable one, and the reason it lives out here: the auto-save's dedup
 * baseline is Toolbar state and the delete happens in the dialog, so nothing
 * short of the real toolbar driving the real dialog over real IndexedDB proves
 * the two agree.
 *
 * Delete the live map and its bytes are in no library row any more — but the
 * baseline still says "already saved, verbatim". New then skips its auto-save
 * and wipes a document that is in no file, no row, and no undo stack, because
 * New clears history.
 */
test('New still saves a doc whose library map was deleted underneath it', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await saveToLibrary(page);

  await openLibrary(page);
  await mapRow(page, 'Untitled map').first().click();
  await page.getByRole('button', { name: 'Delete Untitled map' }).click();
  await page.getByRole('button', { name: 'Sure?' }).click();
  // MANDATORY: without proving the row is really gone, a New that "saved" could
  // just be the original row this test never managed to delete.
  await expect(mapRow(page, 'Untitled map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close map library' }).click();

  await clickNew(page);
  await expect(page.locator('[data-station-id]')).toHaveCount(0);

  // The wiped document must have gone somewhere on the way out.
  await openLibrary(page);
  await expect(mapRow(page, 'Untitled map')).toHaveCount(1);
  await mapRow(page, 'Untitled map').first().click();
  await page.getByRole('button', { name: 'Open version 1' }).click();
  await expect(page.locator('[data-station-id]')).toHaveCount(4);
});

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
  await page.getByRole('button', { name: 'Open version 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Map library' })).toBeHidden();
  await expect(page.locator('[data-station-id]')).toHaveCount(4);
});

test('a version thumbnail is a real raster within the 240×180 box', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await saveToLibrary(page);
  await openLibrary(page);
  await mapRow(page, 'Untitled map').first().click();

  const thumb = page.locator('.map-library-versions img.map-thumb').first();
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

test('the toolbar pill shows the version each save mints', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  // Nothing is saved under this doc yet, so there is no version to name.
  await expect(page.locator('.map-version-pill')).toHaveCount(0);

  await saveToLibrary(page);
  await expect(page.locator('.map-version-pill')).toHaveText('v1');
  // An explicit save is never deduped, so the second one mints v2 even though
  // the doc has not changed.
  await saveToLibrary(page);
  await expect(page.locator('.map-version-pill')).toHaveText('v2');
});

// Three legs, because "two saves → New → a third tagged auto" is self-
// contradictory: New auto-saves the SAME unmutated doc, which is byte-identical
// to v2, so the dedup gate correctly skips and no third version can ever appear.
test.describe('version tagging', () => {
  test('an explicit save is never deduped', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await saveToLibrary(page);
    await saveToLibrary(page);
    await openLibrary(page);
    await mapRow(page, 'Untitled map').first().click();
    await expect(page.locator('.version-row')).toHaveCount(2);
    await expect(page.locator('.version-source')).toHaveText(['user', 'user']);
  });

  test('New writes nothing when the doc has not changed since its save', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await saveToLibrary(page);
    await saveToLibrary(page);
    await clickNew(page);
    await expect(page.locator('[data-station-id]')).toHaveCount(0);

    await openLibrary(page);
    await mapRow(page, 'Untitled map').first().click();
    await expect(page.locator('.version-row')).toHaveCount(2);
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
    await expect(page.locator('.version-row')).toHaveCount(2);
    await expect(page.locator('.version-source')).toHaveText(['auto', 'user']);
  });
});

test('two maps may share a name', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await saveToLibrary(page);
  // New mints a fresh library id, so the next save under the same title is a
  // second MAP rather than a second version of the first. Names do not key the
  // library — ids do.
  await clickNew(page);
  await seedAndOpen(page, fourInLine); // content again, still on the new id
  await saveToLibrary(page);

  await openLibrary(page);
  await expect(page.locator('.map-row')).toHaveCount(2);
  await expect(page.locator('.map-row strong')).toHaveText(['Untitled map', 'Untitled map']);
});
