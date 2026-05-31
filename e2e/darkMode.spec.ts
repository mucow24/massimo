import { test, expect } from '@playwright/test';
import { seedAndOpen, fourInLineWithBulletsAndLabel } from './fixtures';

// The canvas background rect and on-canvas label fills come from the JS theme
// palette (CSS can't reach SVG attribute paint), and the toggle persists via
// the viewport store. This exercises all three: black canvas, white labels,
// and survival across a reload.
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
});
