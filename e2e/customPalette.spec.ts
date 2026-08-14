import { test, expect, type Locator, type Page } from '@playwright/test';
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

// The same map painted by hand: #123456 is in none of the palettes a fresh map
// carries, so it is exactly what the custom colors row collects.
const looseColor: Seed = {
  ...twoStop,
  lines: [{ id: 'L1', service: 'L', color: '#123456', stations: ['A', 'B'] }],
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

const FRRF_COLORS = 5;

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

// A row keeps two commands and stands the rest in its `…` panel, which portals
// to the dialog — so the trigger is found in the ROW and the command it opens
// is found on the page. That the panel is reachable at all is the e2e-only
// half: it mounts inside a modal Radix dialog, whose focus trap jsdom can't
// see, and a panel portalled to the wrong root would be unclickable here.
const rowCommand = async (page: Page, row: Locator, name: string, command: string) => {
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('button', { name: command }).click();
};

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

    await rowCommand(page, libraryRow(page, 'frrf'), 'frrf', 'Delete frrf');
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

  // Our own format: name + description + day/night colors. The description
  // rides the doc's persisted palettes, so the reload proves the sanitize
  // round-trip keeps the new fields.
  test('a massimo-palette file loads, and its description survives a reload', async ({ page }) => {
    const MASSIMO = JSON.stringify({
      format: 'massimo-palette',
      version: 1,
      name: 'inks',
      description: 'weekend reds',
      colors: [
        { name: 'Crimson', day: '#C1272DFF', night: '#7A1A1DFF' },
        { name: 'Sea', day: '#0061A8FF', night: '#0061A8FF' },
      ],
    });
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await page.getByLabel('Load palette file').setInputFiles({
      name: 'inks.palette.json',
      mimeType: 'application/json',
      buffer: Buffer.from(MASSIMO),
    });
    await expect(libraryRow(page, 'inks')).toBeVisible();
    await expect(mapRow(page, 'inks').locator('.palette-strip > span')).toHaveCount(2);

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await openManager(page);
    await rowCommand(page, mapRow(page, 'inks'), 'inks in the map', 'Edit inks in the map');
    await expect(page.getByRole('heading', { level: 3, name: 'inks' })).toBeVisible();
    await expect(page.getByText('weekend reds')).toBeVisible();
    await expect(page.getByText('Crimson')).toBeVisible();
  });

  test('a palette built from scratch in the editor paints a line', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await page.getByRole('button', { name: 'New line…' }).click();

    // The fresh palette opens naming itself; keep the minted name.
    await page.getByRole('textbox', { name: 'Palette name' }).press('Enter');
    await page.getByRole('button', { name: 'Add color' }).click();

    // Recolor through the real color field: swatch → popover → hex field.
    // exact — "Reorder color 1" and "Delete color 1" share the substring.
    await page.getByRole('button', { name: 'Color 1', exact: true }).click();
    await page.getByLabel('Color 1 hex value').fill('#c1272d');
    await page.keyboard.press('Escape'); // closes the picker, not the dialog
    await page.getByRole('button', { name: 'Back to palettes' }).click();
    await closeManager(page);

    await page.locator('[data-band-stripe][data-line-id="L1"]').first().click({ force: true });
    await page.locator('.inspector').waitFor();
    const swatch = page.locator('.inspector').getByTitle('1', { exact: true });
    await swatch.click();
    await expect(page.locator('[data-band-stripe][data-line-id="L1"]').first()).toHaveAttribute(
      'stroke',
      '#c1272d',
    );
  });

  // The custom colors row is the one row the map does not carry, and the only
  // one that breaks the action grid — both of those are CSS facts jsdom can't
  // see, so the italic and the third slot are asserted here.
  test('the custom colors row turns the map’s loose colors into a palette', async ({ page }) => {
    await seedAndOpen(page, looseColor);
    await openManager(page);

    const row = mapRow(page, 'Custom colors');
    await expect(row.locator('.palette-strip > span')).toHaveCount(1);
    await expect(row.locator('strong')).toHaveCSS('font-style', 'italic');
    await expect(row.locator('.dialog-row-actions')).toHaveCSS(
      'grid-template-columns',
      '24px 24px 24px',
    );

    await row.getByRole('button', { name: 'Create palette from these colors' }).click();
    // The fresh palette opens naming itself; keep the minted name.
    await page.getByRole('textbox', { name: 'Palette name' }).press('Enter');
    await page.getByRole('button', { name: 'Back to palettes' }).click();
    await expect(mapRow(page, 'New palette')).toBeVisible();
    // The colors are in a palette now, so there is nothing left to be custom.
    await expect(mapRow(page, 'Custom colors')).toHaveCount(0);
  });

  // The other half of the same idea, in the editor: a flyout of the map's
  // custom colors under Add color. It is a Radix submenu living INSIDE a modal
  // dialog — whether it opens and stays clickable there is an e2e-only fact.
  test('Add color files one of the map’s custom colors into the palette', async ({ page }) => {
    await seedAndOpen(page, looseColor);
    await openManager(page);
    await loadFrrf(page);
    await rowCommand(page, mapRow(page, 'frrf'), 'frrf in the map', 'Edit frrf in the map');

    await page.getByRole('button', { name: 'Add color' }).click();
    await page.getByRole('menuitem', { name: 'Custom color' }).click();
    await page.getByRole('menuitem', { name: 'Add #123456' }).click();

    await expect(page.locator('.palette-editor-row')).toHaveCount(FRRF_COLORS + 1);
    await expect(page.locator('.palette-bullet').last()).toHaveCSS(
      'background-color',
      'rgb(18, 52, 86)',
    );
  });

  test('dragging a row by its handle reorders the palette, and it sticks', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);
    await rowCommand(page, mapRow(page, 'frrf'), 'frrf in the map', 'Edit frrf in the map');

    const names = page.locator('.palette-color-name');
    await expect(names).toHaveText(['1', '2', '3', '4', '5']);
    const handle = page.getByRole('button', { name: 'Reorder color 1' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Two 40px rows down, in steps so pointermoves stream like a real drag.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    await expect(names).toHaveText(['2', '3', '1', '4', '5']);

    // The reorder is doc state: still there after leaving and reopening.
    await page.getByRole('button', { name: 'Back to palettes' }).click();
    await closeManager(page);
    await openManager(page);
    await rowCommand(page, mapRow(page, 'frrf'), 'frrf in the map', 'Edit frrf in the map');
    await expect(names).toHaveText(['2', '3', '1', '4', '5']);
  });

  test('removing a palette from the map takes its colors out of the picker', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await openManager(page);
    await loadFrrf(page);
    await rowCommand(page, mapRow(page, 'frrf'), 'frrf in the map', 'Remove frrf from the map');
    await page.getByRole('button', { name: 'Confirm removing frrf from the map' }).click();
    await expect(mapRow(page, 'frrf')).toHaveCount(0);
    await closeManager(page);

    await page.locator('[data-band-stripe][data-line-id="L1"]').first().click({ force: true });
    await page.locator('.inspector').waitFor();
    await expect(page.locator('.inspector').getByTitle('1', { exact: true })).toHaveCount(0);
  });
});
