import { test, expect, type Page } from '@playwright/test';
import { openMapMenu, seedAndOpen, fourInLineWithBulletsAndLabel } from './fixtures';

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

// The interface theme is the OTHER dark: a local viewing preference
// (viewportStore, persisted, never on the doc) that themes only the chrome,
// leaving the map's canvas exactly as the doc defines it. It's orthogonal to the
// doc's night mode (the moon toggle) — "Dark" is a dark UI over a still-light
// map, "Light" a light UI over a night map.
test.describe('interface theme', () => {
  const pickTheme = async (page: Page, label: string) => {
    await openMapMenu(page);
    await page.getByRole('menuitem', { name: 'Interface theme' }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  };

  test('Dark darkens the chrome only, leaving a light map light on the canvas', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const app = page.locator('.app');
    const host = page.locator('.canvas-host');
    const bg = page.locator('[data-bg]');
    const labelText = page.locator('[data-text-label-id="g1"] text').first();

    // Baseline: light chrome, light canvas.
    await expect(app).not.toHaveAttribute('data-theme', 'dark');
    await expect(bg).toHaveAttribute('fill', '#fafafa');

    await pickTheme(page, 'Dark');

    // Chrome flipped dark…
    await expect(app).toHaveAttribute('data-theme', 'dark');
    // …but the canvas is untouched: bg rect, its host backstop, and the on-canvas
    // label all stay in the doc's (light) palette.
    await expect(bg).toHaveAttribute('fill', '#fafafa');
    await expect(labelText).toHaveAttribute('fill', '#111111');
    await expect(host).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  });

  test('pinned themes ignore the doc night toggle; Auto follows it', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const app = page.locator('.app');
    const bg = page.locator('[data-bg]');

    await pickTheme(page, 'Dark');
    await expect(app).toHaveAttribute('data-theme', 'dark');
    await expect(bg).toHaveAttribute('fill', '#fafafa');

    // Turn the map itself to night: canvas now darkens too, chrome stays dark.
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await expect(app).toHaveAttribute('data-theme', 'dark');
    await expect(bg).toHaveAttribute('fill', '#000000');

    // Light over that night map: chrome relights, canvas stays black.
    await pickTheme(page, 'Light');
    await expect(app).not.toHaveAttribute('data-theme', 'dark');
    await expect(bg).toHaveAttribute('fill', '#000000');

    // Auto: the chrome goes back to following the map.
    await pickTheme(page, 'Auto (follows map)');
    await expect(app).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await expect(app).not.toHaveAttribute('data-theme', 'dark');
    await expect(bg).toHaveAttribute('fill', '#fafafa');
  });

  test('persists across a reload', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    await pickTheme(page, 'Dark');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    // Chrome still dark, canvas still light — the preference rode localStorage.
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-bg]')).toHaveAttribute('fill', '#fafafa');
  });
});

// The canvas color is the paper's own pin: it moves the paper under whichever
// mode the map is in, while the mode's ink stays put and the chrome is untouched.
test.describe('canvas color', () => {
  const pickPaper = async (page: Page, label: string) => {
    await openMapMenu(page);
    await page.getByRole('menuitem', { name: 'Canvas color' }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  };

  test('pins the paper under either map mode, leaving ink and chrome to the mode', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const app = page.locator('.app');
    const bg = page.locator('[data-bg]');
    const labelText = page.locator('[data-text-label-id="g1"] text').first();

    // Dark paper under a day map: black canvas, day ink, light chrome.
    await pickPaper(page, 'Dark');
    await expect(bg).toHaveAttribute('fill', '#000000');
    await expect(labelText).toHaveAttribute('fill', '#111111');
    await expect(app).not.toHaveAttribute('data-theme', 'dark');

    // Light paper under a night map: near-white canvas, night ink, dark chrome.
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await pickPaper(page, 'Light');
    await expect(bg).toHaveAttribute('fill', '#fafafa');
    await expect(labelText).toHaveAttribute('fill', '#ffffff');
    await expect(app).toHaveAttribute('data-theme', 'dark');

    // Auto: the paper goes back to following the mode.
    await pickPaper(page, 'Auto (follows map mode)');
    await expect(bg).toHaveAttribute('fill', '#000000');
  });
});
