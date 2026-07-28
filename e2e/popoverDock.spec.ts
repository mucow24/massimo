import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, bulletCenter, fourInLineWithBullets } from './fixtures';

// Every canvas popover docks to the top-right corner of what the sidebar
// leaves of the canvas host. Real widths only exist in a browser (the panels
// size themselves from CSS: 248 for the item popovers, 320 for the station and
// line editors), so the dock's clearance and its shift when the sidebar opens
// or closes are pinned here rather than in jsdom.
const boxOf = async (page: Page, sel: string) => {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`not visible: ${sel}`);
  return b;
};

async function openBulletPopover(page: Page) {
  await seedAndOpen(page, fourInLineWithBullets);
  // b1 sits at world (-200,-200) — well clear of the sidebar on the right, so
  // it's comfortably clickable to open its popover.
  const c = await bulletCenter(page, 'b1');
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('.bullet-popover')).toBeVisible();
}

test.describe('canvas popovers dock to the top-right corner', () => {
  test('clears the open sidebar, and slides back out when it closes', async ({ page }) => {
    await openBulletPopover(page);
    // The sidebar is open by default (sidebarOpen defaults true; selection
    // state isn't persisted, so every load starts with it shown).
    await expect(page.locator('.sidebar')).toBeVisible();

    const host = await boxOf(page, '.canvas-host');
    const sidebar = await boxOf(page, '.sidebar');
    const docked = await boxOf(page, '.bullet-popover');
    // Fully left of the sidebar, one 8px pad off its edge, 8px down from the
    // top — never tucked under the panel that paints above it.
    expect(docked.x + docked.width).toBeLessThanOrEqual(sidebar.x + 1);
    expect(sidebar.x - (docked.x + docked.width)).toBeCloseTo(8, 0);
    expect(docked.y - host.y).toBeCloseTo(8, 0);

    // Closing the sidebar hands the corner back: the same panel walks right by
    // exactly the strip it was clearing.
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(page.locator('.sidebar')).toHaveCount(0);
    const wide = await boxOf(page, '.bullet-popover');
    expect(wide.x - docked.x).toBeCloseTo(sidebar.width, 0);
    expect(host.x + host.width - (wide.x + wide.width)).toBeCloseTo(8, 0);
  });
});
