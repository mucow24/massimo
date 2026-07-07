import { test, expect } from '@playwright/test';
import { seedAndOpen, bulletCenter, fourInLineWithBullets } from './fixtures';

// The canvas item popovers live inside `.canvas-host`, which must sit BELOW the
// right sidebar: a popover pushed against (or over) the sidebar should be
// occluded by it, not paint on top. The bug was that `.canvas-host` didn't
// establish a stacking context, so the popover shell's `z-index: 1100` escaped
// into the root context and out-ranked the sidebar's `z-index: 1`.
test.describe('canvas popover stacks below the right sidebar', () => {
  test('a popover dragged over the sidebar is occluded by it', async ({ page }) => {
    // b1 sits at world (-200,-200) — well clear of the sidebar on the right, so
    // it's comfortably clickable to open its popover.
    await seedAndOpen(page, fourInLineWithBullets);

    // The sidebar is open by default (sidebarOpen defaults true; selection
    // state isn't persisted, so every load starts with it shown).
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Open the route-bullet popover.
    const c = await bulletCenter(page, 'b1');
    await page.mouse.click(c.x, c.y);
    const popover = page.locator('.bullet-popover');
    await expect(popover).toBeVisible();

    // Drag the popover by its header into the middle of the sidebar, so the two
    // rectangles overlap by a wide margin regardless of the popover's height.
    const sb = await sidebar.boundingBox();
    if (!sb) throw new Error('sidebar not visible');
    const header = popover.locator('.header');
    const hb = await header.boundingBox();
    if (!hb) throw new Error('popover header not visible');
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + 140, { steps: 8 });
    await page.mouse.up();

    // Hit-test the center of the popover∩sidebar overlap: whichever element the
    // browser paints on top is what `elementFromPoint` returns.
    const result = await page.evaluate(() => {
      const pop = document.querySelector('.bullet-popover');
      const side = document.querySelector('.sidebar');
      if (!pop || !side) return null;
      const pr = pop.getBoundingClientRect();
      const sr = side.getBoundingClientRect();
      const x0 = Math.max(pr.left, sr.left);
      const y0 = Math.max(pr.top, sr.top);
      const x1 = Math.min(pr.right, sr.right);
      const y1 = Math.min(pr.bottom, sr.bottom);
      const overlap = x1 > x0 && y1 > y0;
      const el = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      return {
        overlap,
        onSidebar: !!el?.closest('.sidebar'),
        onPopover: !!el?.closest('.bullet-popover'),
      };
    });

    // Guard: the drag actually parked the popover over the sidebar.
    expect(result?.overlap).toBe(true);
    // The sidebar paints on top of the popover at the overlap.
    expect(result?.onSidebar).toBe(true);
    expect(result?.onPopover).toBe(false);
  });
});
