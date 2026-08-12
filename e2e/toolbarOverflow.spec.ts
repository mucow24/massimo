import { test, expect, type Page } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

/**
 * Measure one open panel: its box, and whether the pointer actually reaches it
 * at centre and at its bottom edge — the part a vertical clip eats first.
 *
 * `elementFromPoint` returns null when the point lands on nothing at all, which
 * is precisely the clipped case, so the null has to be rejected before
 * `closest`: `null?.closest(sel) !== null` is `undefined !== null`, i.e. TRUE,
 * and an assertion built on it passes on the very geometry it exists to catch.
 * Sanity-check any edit here by setting PANEL_GAP (usePopover.ts) to 5000 —
 * every case using this must go red.
 */
const probe = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    const at = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && hit.closest(s) !== null;
    };
    return {
      width: r.width,
      height: r.height,
      centre: at(r.x + r.width / 2, r.y + r.height / 2),
      bottom: at(r.x + r.width / 2, r.bottom - 6),
    };
  }, sel);

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

  /**
   * Every panel the toolbar opens, held to the same bar as the Map menu above.
   *
   * The strip's `overflow-x: auto` also computes `overflow-y: auto` — CSS forces
   * the other axis whenever one is non-visible — so the strip clips vertically
   * too, and a panel that merely drops `position: absolute; top: 100%` lands
   * inside the strip's SCROLL AREA rather than over the canvas. That is what
   * caught View and Perf: the Radix menus survived on their fixed-position
   * popper and Help on its `.app` portal, and the rule's escape reasoning was
   * written for those two categories only.
   *
   * Hit-testing, not `toBeVisible()`: a clipped panel keeps its full bounding
   * box, so Playwright calls it visible. Nor may this reach for a locator
   * action — the actionability check scrolls the panel into view, which scrolls
   * the STRIP (toolbar.scrollTop 0 → 283 for View) and hands the assertion the
   * very geometry it is meant to reject.
   */
  const PANELS: ReadonlyArray<{ trigger: string; panel: string }> = [
    { trigger: 'Map', panel: '.menu-panel' },
    { trigger: 'View', panel: '.view-popover' },
    { trigger: 'Perf', panel: '.perf-popover' },
    { trigger: 'Help', panel: '.help-panel' },
  ];

  for (const { trigger, panel } of PANELS) {
    test(`the ${trigger} panel answers the pointer over its whole body`, async ({ page }) => {
      await page.getByRole('button', { name: trigger, exact: true }).click();
      await expect(page.locator(panel)).toBeVisible();
      const reach = await probe(page, panel);
      expect(reach.height).toBeGreaterThan(0);
      expect(reach.centre, `${trigger} panel centre is not hit-testable`).toBe(true);
      expect(reach.bottom, `${trigger} panel bottom edge is not hit-testable`).toBe(true);
    });
  }
});

test('a toolbar panel escapes the strip at a wide window too', async ({ page }) => {
  // The clip does not wait for the strip to actually overflow: `overflow-y`
  // computes to `auto` at every width, so this fails on the same defect with
  // the toolbar comfortably inside the viewport.
  await page.setViewportSize({ width: 1500, height: 900 });
  await seedAndOpen(page, fourInLine);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const overflowed = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar')!;
    return toolbar.scrollWidth > toolbar.clientWidth;
  });
  expect(overflowed, 'this case is meant to run with the strip NOT overflowing').toBe(false);

  const reach = await probe(page, '.view-popover');
  expect(reach.centre, 'View panel centre is not hit-testable').toBe(true);
  expect(reach.bottom, 'View panel bottom edge is not hit-testable').toBe(true);
  // The panel's width is no longer set by its containing block — a fixed box
  // shrink-to-fits against the VIEWPORT, so dropping the explicit width for the
  // `min-width` this used to carry sprawls it to 379px of max-content.
  expect(reach.width, 'View panel is not at its designed width').toBe(168);
});
