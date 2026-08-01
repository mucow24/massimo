import { test, expect, type Locator } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

/**
 * The View menu's checkboxes are the shared `FieldCheckbox` (Radix), but they
 * render INSIDE `.toolbar`, whose generic button chrome outranks the shared
 * `.field-checkbox` rules and applied its whole recipe to them — the padding
 * stretched the 16px square into a 21×16 oblong. Options' palette checkboxes
 * wore it long before this menu existed; a list of nine is what made it
 * impossible to miss.
 *
 * jsdom has no cascade and no layout, so only a real browser can catch that
 * class of defect. The oblong is the one confirmed regression here (reverting
 * the fix fails the first test at 22px); the hover and click cases below are
 * invariants for the states a user reads while pointing at a row, not guards
 * over a bug that was observed.
 */

const box = (page: import('@playwright/test').Page, label: string): Locator =>
  page.locator('.view-popover').getByRole('checkbox', { name: label, exact: true });

const bgOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('View menu checkboxes', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('.view-popover')).toBeVisible();
  });

  test('every box is a 16px square, not a button-padded oblong', async ({ page }) => {
    const boxes = page.locator('.view-popover .field-checkbox');
    const n = await boxes.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const b = await boxes.nth(i).boundingBox();
      expect(b, `checkbox ${i} has no box`).not.toBeNull();
      expect(Math.round(b!.width), `checkbox ${i} width`).toBe(16);
      expect(Math.round(b!.height), `checkbox ${i} height`).toBe(16);
    }
  });

  test('a checked box keeps its accent fill under the pointer', async ({ page }) => {
    // The regression: hover repainted it with the toolbar's near-white control
    // hover, so checked and unchecked became indistinguishable while pointing at
    // them — exactly when you need to read the state.
    const checked = box(page, 'Lines and stations');
    await expect(checked).toHaveAttribute('aria-checked', 'true');
    // Park the pointer somewhere harmless FIRST. Opening the menu leaves the
    // mouse wherever the trigger was, which can already be over a row — sampling
    // "at rest" then reads the hovered colour and the comparison below can never
    // fail, however broken the hover is.
    await page.mouse.move(2, 400);
    const atRest = await bgOf(checked);
    await checked.hover();
    expect(await bgOf(checked), 'hover changed the checked fill').toBe(atRest);
    // ...and the tick is still painted over it.
    await expect(checked.locator('svg')).toBeVisible();
  });

  test('an unchecked box stays visibly different from a checked one on hover', async ({ page }) => {
    const unchecked = box(page, 'Anchors');
    await expect(unchecked).toHaveAttribute('aria-checked', 'false');
    await page.mouse.move(2, 400);
    const checkedRest = await bgOf(box(page, 'Lines and stations'));
    await unchecked.hover();
    expect(await bgOf(unchecked), 'hovered-unchecked matches checked').not.toBe(checkedRest);
  });

  test('clicking a box flips it, and the tick follows', async ({ page }) => {
    const polygons = box(page, 'Polygons');
    await expect(polygons).toHaveAttribute('aria-checked', 'true');
    await polygons.click();
    await expect(polygons).toHaveAttribute('aria-checked', 'false');
    await expect(polygons.locator('svg')).toHaveCount(0);
    await polygons.click();
    await expect(polygons).toHaveAttribute('aria-checked', 'true');
    await expect(polygons.locator('svg')).toBeVisible();
  });
});
