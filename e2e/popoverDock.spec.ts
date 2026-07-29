import { test, expect, type Page } from '@playwright/test';
import {
  seedAndOpen,
  bulletCenter,
  labelCenter,
  fourInLineWithBullets,
  type Seed,
} from './fixtures';

// Every canvas popover docks to the top-right corner of what the sidebar
// leaves of the canvas host. Real widths, heights, and paint order only exist
// in a browser (the panels size themselves from CSS: 248 for the item
// popovers, 320 for the station and line editors), so the dock's clearance,
// its shift when the sidebar opens or closes, its height clamp, and its
// stacking under the sidebar are all pinned here rather than in jsdom.
const boxOf = async (page: Page, sel: string) => {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`not visible: ${sel}`);
  return b;
};

// One label whose Text box was left stretched to 2000px — taller than any
// window, which is reachable because the height is remembered per label and
// re-applied on every open (a stretch on a big screen, reopened on a small one).
const stretchedLabel: Seed = {
  stations: [],
  lines: [],
  textLabels: [{ id: 'g1', x: -200, y: 0, text: 'Midtown', editorHeight: 2000 }],
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

  // `.toolbar { min-width: max-content }` floors the app grid — and with it the
  // canvas host — at the toolbar's natural ~1189px, so a narrower window leaves
  // the host wider than itself and the PAGE scrolls sideways, carrying the
  // host's top-right corner off the right of the screen. Only a browser has the
  // toolbar's natural width, a real page scroll, and the scrollbars that come
  // with it, so the dock's window-tracking is pinned here.
  test('follows a narrow window across a horizontal scroll, then settles at its dock', async ({
    page,
  }) => {
    await openBulletPopover(page);
    // Narrowed after the popover is open — at 700 there is no bare canvas left
    // to click, and the sidebar's own edge (host x ≈ 869) sits off screen, so
    // the window's edge is the only thing left to dock against.
    await page.setViewportSize({ width: 700, height: 820 });

    // Every reading is taken fresh and polled: a resize or a scroll reaches the
    // dock a frame after Playwright's promise resolves, so a single shot can
    // catch the panel still at its pre-resize position.
    const gapToWindowRight = async () => {
      const b = await boxOf(page, '.bullet-popover');
      const winW = await page.evaluate(() => document.documentElement.clientWidth);
      return Math.round(winW - (b.x + b.width));
    };

    // Scrolled hard left, where the host's own corner is ~489px off screen: the
    // panel is at the window's right edge, one 8px pad off it.
    await expect.poll(gapToWindowRight).toBe(8);

    const m = await page.evaluate(() => ({
      hostW: document.querySelector('.canvas-host')!.clientWidth,
      winW: document.documentElement.clientWidth,
      maxScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    // Guards, read once the narrowing has settled: the app really is wider than
    // the window and the page really does scroll — without both, the assertion
    // above and those below prove nothing.
    expect(m.hostW).toBeGreaterThan(m.winW);
    expect(m.maxScroll).toBeGreaterThan(0);

    // Mid-scroll it holds that same edge — it tracked the page pixel for pixel
    // instead of riding away with the host.
    await page.evaluate(() => window.scrollTo(150, 0));
    await expect.poll(gapToWindowRight).toBe(8);

    // At the end of the travel the sidebar's edge has come into view and is the
    // nearer obstacle: the panel settles into its home dock and stops.
    await page.evaluate((x) => window.scrollTo(x, 0), m.maxScroll);
    await expect
      .poll(async () => {
        const sidebar = await boxOf(page, '.sidebar');
        const end = await boxOf(page, '.bullet-popover');
        return Math.round(sidebar.x - (end.x + end.width));
      })
      .toBe(8);
  });

  // The panel is pinned to the window, so one taller than it runs off the
  // bottom with no way to reach what's down there — Lock and Delete
  // included. The body clamps to the viewport and scrolls inside itself, the
  // footer sticks to the shell's bottom edge, and the one control a user can
  // drag past the window (the Text box) is capped short of it.
  test('clamps a stretched panel to the viewport and keeps its footer reachable', async ({
    page,
  }) => {
    await seedAndOpen(page, stretchedLabel);
    const c = await labelCenter(page, 'g1');
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.text-label-popover')).toBeVisible();

    const m = await page.evaluate(() => {
      const shell = document.querySelector('.text-label-popover') as HTMLElement;
      const body = shell.querySelector('.body') as HTMLElement;
      const box = shell.querySelector('textarea') as HTMLElement;
      const host = document.querySelector('.canvas-host') as HTMLElement;
      return {
        // Guard: the panel really does have more content than fits, so the
        // clamp is what's being measured and not a panel that simply fits.
        bodyScrolls: body.scrollHeight > body.clientHeight,
        // `overflow-y: auto` computes overflow-x to `auto` as well, so the
        // footer's negative side margins (which span the body's padding to
        // draw its full-width divider) must land exactly on the padding edge
        // rather than a hair past it — a stray horizontal scrollbar otherwise.
        bodyOverflowsX: body.scrollWidth > body.clientWidth,
        shellBottom: shell.getBoundingClientRect().bottom,
        hostBottom: host.getBoundingClientRect().bottom,
        boxHeight: box.getBoundingClientRect().height,
        windowHeight: window.innerHeight,
      };
    });

    expect(m.bodyScrolls).toBe(true);
    expect(m.bodyOverflowsX).toBe(false);
    // The whole shell fits inside the host that clips it.
    expect(m.shellBottom).toBeLessThanOrEqual(m.hostBottom);
    // The stored 2000px never reaches the DOM at face value.
    expect(m.boxHeight).toBeLessThan(m.windowHeight);
    // Sticky footer: Delete rides the shell's bottom edge instead of sitting
    // 2000px down the scroll.
    await expect(page.locator('.text-label-popover .footer .delete-btn')).toBeInViewport();
  });
});

test.describe('canvas popovers stack below the sidebar', () => {
  // `.toolbar { min-width: max-content }` floors the app grid — and with it the
  // canvas host — at the toolbar's natural ~1189px however narrow the window
  // gets, so the dock's 8px clearance always lands a panel left of the sidebar
  // and usePinnedPopover's clamped-x branch (`Math.max(EDGE_PAD, …)`) is never
  // taken in the app as it ships. Drop that floor to reach it: at a host of 420
  // the sidebar eats all but 100px, the 248px panel floors at x = 8, and the two
  // overlap by a wide margin. What must hold there is the paint order —
  // `.canvas-host`'s `isolation: isolate` traps the shell's z-index:1100 inside
  // the canvas layer, so the sidebar (z-index:1, its sibling in the same grid
  // cell) still covers it. Without the isolation the 1100 escapes into the ROOT
  // stacking context and the panel paints over the sidebar; that was the bug.
  test('a panel forced under the sidebar is occluded by it', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBullets);
    // Open the popover at the default window, where the bullet is reachable —
    // once the host is narrowed there is no bare canvas left to click.
    const c = await bulletCenter(page, 'b1');
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.bullet-popover')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.addStyleTag({ content: '.toolbar { min-width: 0 }' });
    await page.setViewportSize({ width: 420, height: 820 });
    // Guard: the narrowing actually drove the pin into its clamped-x branch.
    await expect(page.locator('.bullet-popover')).toHaveCSS('left', '8px');

    const result = await page.evaluate(() => {
      const pop = document.querySelector('.bullet-popover') as HTMLElement;
      const side = document.querySelector('.sidebar') as HTMLElement;
      const pr = pop.getBoundingClientRect();
      const sr = side.getBoundingClientRect();
      const x0 = Math.max(pr.left, sr.left);
      const y0 = Math.max(pr.top, sr.top);
      const x1 = Math.min(pr.right, sr.right);
      const y1 = Math.min(pr.bottom, sr.bottom);
      // Hit-test the center of the popover ∩ sidebar overlap: whichever
      // element the browser paints on top is what elementFromPoint returns.
      const el = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      return {
        overlapW: x1 - x0,
        overlapH: y1 - y0,
        onSidebar: !!el?.closest('.sidebar'),
        onPopover: !!el?.closest('.bullet-popover'),
      };
    });

    // Guard: the two rectangles really do overlap.
    expect(result.overlapW).toBeGreaterThan(0);
    expect(result.overlapH).toBeGreaterThan(0);
    // The sidebar paints on top of the popover at the overlap.
    expect(result.onSidebar).toBe(true);
    expect(result.onPopover).toBe(false);
  });
});
