import { test, expect } from '@playwright/test';
import { openMapMenu, seedAndOpen, fourInLine } from './fixtures';

// Chrome text — wordmark, popover titles, field labels, button captions, menu
// entries — is UI, not content: a drag across the app must not leave a text
// selection behind. One global rule makes everything under `.app` unselectable;
// the editable controls opt back in so their own contents stay selectable and
// copyable. Only a real browser computes `user-select` from the stylesheet
// (jsdom doesn't), so this lives in the Playwright suite.
test.describe('unselectable chrome', () => {
  test('non-editable UI text is unselectable, editable inputs stay selectable', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Always-present chrome text: the wordmark's "M" (the badge is an SVG, and
    // its glyph inherits the rule like any other chrome text) and the map-name
    // button caption.
    await expect(page.locator('.toolbar .brand-bullet text')).toHaveCSS('user-select', 'none');
    await expect(page.locator('.toolbar button.map-name')).toHaveCSS('user-select', 'none');

    // Menu entries are UI text too — open Map and check a live item.
    await openMapMenu(page);
    await expect(page.locator('.menu-panel .menu-item').first()).toHaveCSS('user-select', 'none');
    await page.keyboard.press('Escape');

    // The editable map-name field opts back in: clicking the caption swaps in
    // its input, whose contents must stay selectable.
    await page.locator('.toolbar button.map-name').click();
    await expect(page.locator('input.map-name-input')).toHaveCSS('user-select', 'text');
  });
});
