import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, fourInLine } from './fixtures';

// Right-clicking a segment connector in the line editor's tree removes that
// edge — and that must work in BOTH view mode and Edit Stops mode. Edit Stops
// (uiMode 'appending-to-line') is exactly when you're restructuring the line,
// so backing the mode out on a sidebar right-click (the document-level
// cancel-a-mode handler) would make edge removal unreachable right when it's
// wanted (e.g. deleting a just-drawn loop edge).

const stripe = (page: Page) => page.locator('[data-band-stripe][data-line-id="L1"]').first();

async function openLineEditor(page: Page): Promise<void> {
  await stripe(page).click({ force: true });
  await page.locator('.inspector').waitFor();
}

const connectors = (page: Page) => page.locator('.inspector [data-segment-connector]');

test('right-click removes a tree edge in view mode', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openLineEditor(page);
  await expect(connectors(page)).toHaveCount(3); // A-B, B-C, C-D

  await connectors(page).first().click({ button: 'right', force: true });
  await expect(connectors(page)).toHaveCount(2);
});

test('right-click removes a tree edge in Edit Stops mode and stays in the mode', async ({
  page,
}) => {
  await seedAndOpen(page, fourInLine);
  await openLineEditor(page);
  await expect(connectors(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Edit Stops' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

  await connectors(page).first().click({ button: 'right', force: true });

  // The edge is removed AND the editor stays in Edit Stops: the right-click
  // belongs to the sidebar control, not the cancel-the-mode gesture.
  await expect(connectors(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
});
