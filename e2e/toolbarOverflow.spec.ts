import { test, expect } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

/**
 * At any window narrower than the toolbar's natural width (~1120px), the PAGE
 * used to grow a horizontal scrollbar (`min-width: max-content` on the
 * toolbar): the whole app — canvas included — panned sideways, and the window
 * scrollbar overlaid the bottom stripe of the 100vh app, burying the
 * lower-left guide well. The toolbar now scrolls its own overflow instead:
 * the document never scrolls, every button stays reachable inside the strip,
 * and the canvas's bottom edge answers the pointer at every width.
 *
 * jsdom has no layout, so only a real browser can hold any of this.
 */
test.describe('toolbar overflow at a narrow window', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedAndOpen(page, fourInLine);
  });

  test('the page never scrolls sideways; the toolbar scrolls its own tail', async ({ page }) => {
    const m = await page.evaluate(() => {
      const toolbar = document.querySelector('.toolbar')!;
      return {
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        toolbarScrollW: toolbar.scrollWidth,
        toolbarClientW: toolbar.clientWidth,
      };
    });
    expect(m.docScrollW).toBeLessThanOrEqual(m.docClientW);
    // The tail is scrolled-to, not clipped away: the strip still holds its
    // full content width.
    expect(m.toolbarScrollW).toBeGreaterThan(m.toolbarClientW);
  });

  test('the lower-left guide well sits inside the scrollbar-free viewport', async ({ page }) => {
    const box = await page.locator('.guide-well-corner-bl').boundingBox();
    const clientH = await page.evaluate(() => document.documentElement.clientHeight);
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(clientH + 0.5);
  });

  test('the un-portaled toolbar menus escape the scrolling strip', async ({ page }) => {
    // The Map menu's panel renders INSIDE `.toolbar` on purpose (design
    // tokens; see Menu.tsx) — this holds that the toolbar's overflow rule
    // does not clip it. The last row must be truly clickable, not just
    // present.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const panel = page.locator('.menu-panel');
    await expect(panel).toBeVisible();
    const last = panel.getByRole('menuitem').last();
    await expect(last).toBeVisible();
    const box = await last.boundingBox();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.menu-item') !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    );
    expect(hit).toBe(true);
  });
});
