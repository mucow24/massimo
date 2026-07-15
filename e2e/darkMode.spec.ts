import { test, expect } from '@playwright/test';
import { seedAndOpen, fourInLineWithBulletsAndLabel } from './fixtures';

// The canvas background rect and on-canvas label fills come from the JS theme
// palette (CSS can't reach SVG attribute paint), and the mode is a field on the
// DOC (MapDoc.darkMode), so it persists with the document. This exercises all
// three: black canvas, white labels, and survival across a reload.
test.describe('dark mode', () => {
  test('toggle blackens the canvas, whitens labels, and persists across reload', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const bg = page.locator('[data-bg]');
    const labelText = page.locator('[data-text-label-id="g1"] text').first();

    // Light defaults.
    await expect(bg).toHaveAttribute('fill', '#fafafa');
    await expect(labelText).toHaveAttribute('fill', '#111111');

    await page.getByRole('button', { name: 'Toggle dark mode' }).click();

    await expect(bg).toHaveAttribute('fill', '#000000');
    await expect(labelText).toHaveAttribute('fill', '#ffffff');

    // Persisted to localStorage → still dark after a reload.
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(page.locator('[data-bg]')).toHaveAttribute('fill', '#000000');
    await expect(page.locator('[data-text-label-id="g1"] text').first()).toHaveAttribute(
      'fill',
      '#ffffff',
    );
  });

  // The point of putting the mode in the doc: a map that was SAVED as a night
  // map opens dark, with nobody touching the toggle. The seed carries darkMode
  // in the persisted doc blob, so this drives the real rehydrate path.
  test('a map saved as a night map opens dark, with no toggle click', async ({ page }) => {
    await seedAndOpen(page, { ...fourInLineWithBulletsAndLabel, darkMode: true });

    await expect(page.locator('[data-bg]')).toHaveAttribute('fill', '#000000');
    await expect(page.locator('[data-text-label-id="g1"] text').first()).toHaveAttribute(
      'fill',
      '#ffffff',
    );
    // The button reflects the doc's mode, so it offers the way BACK to light.
    await expect(page.getByRole('button', { name: 'Toggle dark mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // Polygons carry independent light/dark colors. This covers the rehydrate
  // path specifically: a polygon seeded WITHOUT dark fields (a pre-dark-mode
  // save) must be backfilled by the store's migrate step, or it would paint
  // `undefined` in dark mode. A second polygon with explicit dark colors
  // confirms the override is used.
  test('polygon dark colors paint in dark mode; legacy polygons are backfilled on load', async ({
    page,
  }) => {
    const square = (cx: number) => [
      { x: cx - 40, y: -40 },
      { x: cx + 40, y: -40 },
      { x: cx + 40, y: 40 },
      { x: cx - 40, y: 40 },
    ];
    await seedAndOpen(page, {
      stations: [],
      lines: [],
      polygons: [
        {
          id: 'pDark',
          vertices: square(-150),
          fill: '#112233',
          stroke: '#445566',
          darkFill: '#778899',
          darkStroke: '#99aabb',
        },
        // No dark fields → simulates a save predating dark mode.
        { id: 'pLegacy', vertices: square(150), fill: '#abcdef', stroke: '#123456' },
      ],
    });

    const dark = page.locator('[data-polygon-id="pDark"]');
    const legacy = page.locator('[data-polygon-id="pLegacy"]');

    // Light mode shows the light colors.
    await expect(dark).toHaveAttribute('fill', '#112233');
    await expect(legacy).toHaveAttribute('fill', '#abcdef');

    await page.getByRole('button', { name: 'Toggle dark mode' }).click();

    // Explicit dark overrides win.
    await expect(dark).toHaveAttribute('fill', '#778899');
    await expect(dark).toHaveAttribute('stroke', '#99aabb');
    // Legacy polygon was backfilled on rehydrate → dark == light, not empty.
    await expect(legacy).toHaveAttribute('fill', '#abcdef');
    await expect(legacy).toHaveAttribute('stroke', '#123456');
  });
});
