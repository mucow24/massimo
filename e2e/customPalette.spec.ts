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

async function openPalettes(page: Page): Promise<void> {
  // The Options popover is palettes-only now — the list renders directly,
  // no disclosure to expand.
  await page.getByRole('button', { name: 'Options' }).click();
}

async function loadFrrf(page: Page): Promise<void> {
  await page.getByLabel('Load palette file').setInputFiles({
    name: 'frrf.json',
    mimeType: 'application/json',
    buffer: Buffer.from(FRRF),
  });
}

test.describe('custom palettes', () => {
  test('load adds an unchecked card; activation survives reload; delete removes it', async ({
    page,
  }) => {
    await seedAndOpen(page, twoStop);
    await openPalettes(page);

    await loadFrrf(page);

    // An unchecked "frrf" card with 5 swatches appears.
    const frrf = page.getByRole('checkbox', { name: 'frrf' });
    await expect(frrf).toBeVisible();
    await expect(frrf).not.toBeChecked();
    const card = page.locator('.options-palette-card', { has: frrf });
    await expect(card.locator('.options-palette-strip > span')).toHaveCount(5);

    // Activate it.
    await frrf.check();
    await expect(frrf).toBeChecked();

    // Reload: both the definition (localStorage) and the active state (doc)
    // survive rehydrate — the custom store hydrates before the doc store's
    // migrate validates active ids.
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await openPalettes(page);
    const frrfAfter = page.getByRole('checkbox', { name: 'frrf' });
    await expect(frrfAfter).toBeVisible();
    await expect(frrfAfter).toBeChecked();

    // Delete via the red ×.
    await page.getByRole('button', { name: 'Delete frrf' }).click();
    await expect(page.getByRole('checkbox', { name: 'frrf' })).toHaveCount(0);
  });

  test('an active custom palette shows in the line color picker with line-name hovers', async ({
    page,
  }) => {
    await seedAndOpen(page, twoStop);
    await openPalettes(page);
    await loadFrrf(page);
    await page.getByRole('checkbox', { name: 'frrf' }).check();
    await page.keyboard.press('Escape'); // close the options popover

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
});
