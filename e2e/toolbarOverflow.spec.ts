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
 * grows the one standard window-wide horizontal scrollbar: `min-width:
 * max-content` on the toolbar floors the app grid at the strip's natural
 * width, the page scrolls sideways, and the strip itself NEVER scrolls — a
 * toolbar with its own scrollbar is nonstandard chrome, and its bar ate the
 * buttons' breathing room. The hazard that once argued for an internally
 * scrolling strip — the window scrollbar burying the lower-left guide well at
 * the foot of the grid — is closed at the source instead: `.app` sizes by
 * `height: 100%`, which (unlike `vh`) subtracts window scrollbars, so the
 * grid's bottom stripe rides ABOVE the bar. Both halves are pinned here.
 *
 * jsdom has no layout, so only a real browser can hold any of this.
 */
test.describe('toolbar overflow at a narrow window', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedAndOpen(page, fourInLine);
  });

  test('the toolbar never scrolls itself; the page scrolls sideways', async ({ page }) => {
    const m = await page.evaluate(() => {
      const toolbar = document.querySelector('.toolbar')!;
      return {
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        toolbarScrollW: toolbar.scrollWidth,
        toolbarClientW: toolbar.clientWidth,
        // offsetHeight − clientHeight is the border (1px) plus any horizontal
        // scrollbar band the strip is paying for out of its own 44px row.
        toolbarChromeH: (toolbar as HTMLElement).offsetHeight - toolbar.clientHeight,
      };
    });
    // The page overflows and scrolls; the strip holds no overflow of its own.
    expect(m.docScrollW).toBeGreaterThan(m.docClientW);
    expect(m.toolbarScrollW).toBeLessThanOrEqual(m.toolbarClientW + 1);
    // No scrollbar band inside the strip: the buttons keep the full row.
    expect(m.toolbarChromeH).toBeLessThanOrEqual(2);
  });

  test('the lower-left guide well stays above the window scrollbar', async ({ page }) => {
    // Headless Chromium paints no space-taking scrollbars (innerHeight always
    // equals clientHeight here), so a real bar's burial cannot be reproduced
    // in CI. What CAN be held is the mechanism that decides burial in a
    // desktop browser: `.app` must size from the html height CHAIN —
    // percentages subtract window scrollbars — and not from `vh`, which
    // ignores them by definition. Shrinking the chain's root stands in for
    // the scrollbar shaving the client box (the same injection idiom as
    // popoverDock.spec's floor): under `height: 100vh` the app ignores it and
    // this well sinks below the line; under `height: 100%` everything rides up.
    const clientH = await page.evaluate(() => document.documentElement.clientHeight);
    const before = await page.locator('.guide-well-corner-bl').boundingBox();
    expect(before).not.toBeNull();
    expect(before!.y + before!.height).toBeLessThanOrEqual(clientH + 0.5);

    const BAR = 15; // a classic Windows horizontal scrollbar
    await page.addStyleTag({ content: `html { height: calc(100% - ${BAR}px) }` });
    const app = await page.locator('.app').boundingBox();
    expect(
      app!.height,
      'the app must follow the html height chain, not 100vh',
    ).toBeLessThanOrEqual(clientH - BAR + 0.5);
    // The well rides up with it and still answers the pointer at its centre.
    const box = await page.locator('.guide-well-corner-bl').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(clientH - BAR + 0.5);
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.guide-well-corner-bl') != null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    );
    expect(hit, 'lower-left well centre is not hit-testable').toBe(true);
  });

  test('the Map menu renders inside the toolbar and stays clickable', async ({ page }) => {
    // The Map menu's panel renders INSIDE `.toolbar` on purpose (design
    // tokens; see Menu.tsx) — this holds that nothing about the strip clips
    // it. The last row must be truly clickable, not just present.
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
   * The right-hand triggers (View, Developer, Help) sit past the 900px window
   * at rest; Playwright's click scrolls the WINDOW right to reach them — the
   * standard behavior this spec pins — and usePopover measures the trigger
   * after that scroll, so the fixed panel lands under it in viewport space.
   *
   * Hit-testing, not `toBeVisible()`: a clipped panel keeps its full bounding
   * box, so Playwright calls it visible.
   */
  const PANELS: ReadonlyArray<{ trigger: string; panel: string }> = [
    { trigger: 'Map', panel: '.menu-panel' },
    { trigger: 'View', panel: '.view-popover' },
    { trigger: 'Developer', panel: '.dev-popover' },
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

  test('an open panel follows its trigger through a page scroll', async ({ page }) => {
    // The panels are position:fixed, so a page scroll moves the trigger in
    // viewport space and the panel only follows if usePopover's re-measure
    // hears the scroll. This pins that contract — including the listeners
    // being dropped outright — but not the choice of listener idiom: this
    // (frame-producing) page delivered the scroll to the previous
    // window-capture listener too. Hand-verifying the difference is its own
    // trap: a page producing NO frames dispatches no scroll events to any
    // listener at all (see popoverDock.spec's wheel-scroll note), which reads
    // as a stranded panel whatever the code says.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('.view-popover')).toBeVisible();
    const gap = () =>
      page.evaluate(() => {
        const t = document.querySelector('.view-popover-wrap')!.getBoundingClientRect();
        const p = document.querySelector('.view-popover')!.getBoundingClientRect();
        return Math.round(p.right - t.right);
      });
    expect(await gap()).toBe(0); // right edges flush at open

    // Scroll toward the strip's tail with the panel open — the trigger slides
    // left in viewport space and the fixed panel must ride along. Guard the
    // premise: the page really moved (the View trigger itself is on-screen at
    // 900px, so nothing here scrolls implicitly).
    await page.evaluate(() => window.scrollTo(150, 0));
    const scrolled = await page.evaluate(() => window.scrollX);
    expect(scrolled, 'premise: the page really scrolled').toBeGreaterThanOrEqual(100);
    await expect.poll(gap).toBe(0);
  });
});

test('a wide window fits the toolbar with no scrollbar anywhere', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await seedAndOpen(page, fourInLine);
  const m = await page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  }));
  expect(m.docScrollW, 'this case is meant to run with the page NOT overflowing').toBeLessThanOrEqual(
    m.docClientW,
  );

  await page.getByRole('button', { name: 'View', exact: true }).click();
  const reach = await probe(page, '.view-popover');
  expect(reach.centre, 'View panel centre is not hit-testable').toBe(true);
  expect(reach.bottom, 'View panel bottom edge is not hit-testable').toBe(true);
  // The panel's width is not set by its containing block — a fixed box
  // shrink-to-fits against the VIEWPORT, so dropping the explicit width for the
  // `min-width` this used to carry sprawls it to 379px of max-content.
  expect(reach.width, 'View panel is not at its designed width').toBe(168);
});
