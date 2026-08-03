import { test, expect, type Locator } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

/**
 * The View menu's checkboxes are the shared `FieldCheckbox` (Radix), but they
 * render INSIDE `.toolbar`, whose generic button chrome outranks the shared
 * `.field-checkbox` rules and applied its whole recipe to them. Two of its
 * declarations landed, and both are regressions this file guards:
 *
 *  - `padding: 4px 10px` stretched the 16px square into a 21×16 oblong;
 *  - `.toolbar button:hover` (0,2,1) outranks `.field-checkbox[data-state=
 *    'checked']` (0,2,0), so pointing at a TICKED box repainted its accent fill
 *    with `--control-hover` (#f0f0f0) — a white tick on near-white, which reads
 *    as unchecked. That is what made it impossible to tell whether a click had
 *    registered.
 *
 * The retired palette checkboxes wore both long before this menu existed; a
 * list of nine is what made them impossible to miss.
 *
 * jsdom has no cascade and no layout, so only a real browser catches this class
 * of defect — and a real browser needs `settle()` below to catch the second one.
 */

const box = (page: import('@playwright/test').Page, label: string): Locator =>
  page.locator('.view-popover').getByRole('checkbox', { name: label, exact: true });

const bgOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);

/**
 * Hover, then wait out `.field-checkbox`'s `transition: background-color 120ms`.
 *
 * Reading `getComputedStyle().backgroundColor` straight after `.hover()` samples
 * the transition at t≈0 and returns the PRE-hover colour, so every assertion
 * below it passes no matter how broken the hover is. That vacuity is why the
 * hover defect above was first written off as unreproducible.
 */
async function hoverAndSettle(l: Locator): Promise<void> {
  await l.hover();
  await l.page().waitForTimeout(400);
}

/** Park the pointer off every row: opening the menu leaves the mouse wherever
 *  the trigger was, which can already be over one, and then "at rest" samples
 *  the hovered colour. */
async function parkPointer(page: import('@playwright/test').Page): Promise<void> {
  await page.mouse.move(2, 400);
  await page.waitForTimeout(400);
}

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
    // The regression: hover repainted the accent fill with the toolbar's
    // near-white control hover, leaving a white tick on near-white — so a ticked
    // box read as unticked exactly when you were pointing at it to check.
    const checked = box(page, 'Lines and stations');
    await expect(checked).toHaveAttribute('aria-checked', 'true');
    await parkPointer(page);
    const atRest = await bgOf(checked);
    await hoverAndSettle(checked);
    expect(await bgOf(checked), 'hover changed the checked fill').toBe(atRest);
    // ...and the tick is still painted over it.
    await expect(checked.locator('svg')).toBeVisible();
  });

  test('checked and unchecked stay distinguishable while each is hovered', async ({ page }) => {
    // Compares the two UNDER THE POINTER, not one hovered against the other at
    // rest: the broken rule painted both with the same control-hover wash, so a
    // hovered-vs-resting comparison still saw a difference and stayed green.
    const checked = box(page, 'Lines and stations');
    const unchecked = box(page, 'Anchors');
    await expect(checked).toHaveAttribute('aria-checked', 'true');
    await expect(unchecked).toHaveAttribute('aria-checked', 'false');
    await hoverAndSettle(checked);
    const hoveredChecked = await bgOf(checked);
    await hoverAndSettle(unchecked);
    const hoveredUnchecked = await bgOf(unchecked);
    expect(hoveredChecked, 'the two states look identical under the pointer').not.toBe(
      hoveredUnchecked,
    );
  });

  test('the marked View button still answers the pointer', async ({ page }) => {
    // `.has-hidden` sits at (0,4,1) and `.tool-btn:hover` at (0,3,1), so the
    // mark outranks the hover — leaving the one button in the toolbar that stops
    // responding, exactly when it is the one you want to click.
    const view = page.getByRole('button', { name: 'View', exact: true });
    await box(page, 'Polygons').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.view-popover')).toHaveCount(0);
    await expect(view).toHaveClass(/has-hidden/);
    await parkPointer(page);
    const atRest = await bgOf(view);
    await hoverAndSettle(view);
    expect(await bgOf(view), 'marked button ignores hover').not.toBe(atRest);
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
