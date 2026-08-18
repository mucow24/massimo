import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

/**
 * What an open modal overlay — a `field-select` menu, a dialog — must NOT do to
 * the map behind it. Radix raises both halves of the barrier itself: `body {
 * pointer-events: none }` (DismissableLayer) and a react-remove-scroll page
 * lock. Each half misses this app in its own way, and both are layout/hit-test
 * facts, so only a real browser can hold them.
 */

// A polygon selects into a popover carrying the colour menus, and its body is
// a fat, unmissable canvas hit target for the press-through test.
const seed = {
  stations: [{ id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
  polygons: [
    {
      id: 'P1',
      vertices: [
        { x: -240, y: -80 },
        { x: -80, y: -80 },
        { x: -80, y: 80 },
        { x: -240, y: 80 },
      ],
      fill: '#cde',
      stroke: '#036',
    },
  ],
};

/** Select the polygon (its popover holds the menus) and open the first one. */
async function openMenuOverTheMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __massimo: {
        stores: { selection: { getState: () => { setPolygonSelection: (ids: string[]) => void } } };
      };
    };
    w.__massimo.stores.selection.getState().setPolygonSelection(['P1']);
  });
  await page.locator('.polygon-popover').waitFor();
  await page.locator('.polygon-popover .field-select').first().click();
  await expect(page.locator('.field-select-panel')).toBeVisible();
}

test('an open menu leaves the page scrollbar — and so the canvas — where it was', async ({
  page,
}) => {
  // Narrow enough that the toolbar's min-width floors the app wider than the
  // window and the page grows its one horizontal scrollbar (toolbarOverflow
  // holds that regime). That bar costs the client box its own thickness, and
  // `.app`'s height: 100% hands the loss straight to `.canvas-host`.
  await page.setViewportSize({ width: 820, height: 460 });
  await seedAndOpen(page, seed);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThan(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await openMenuOverTheMap(page);

  // The lock's own attribute is up — this is the real react-remove-scroll, not
  // a stand-in — but the page's overflow is untouched, so the bar (and every
  // box measured from the client height) stays exactly as it was.
  const locked = await page.evaluate(() => ({
    attr: document.body.hasAttribute('data-scroll-locked'),
    overflow: getComputedStyle(document.body).overflow,
  }));
  expect(locked.attr).toBe(true);
  expect(locked.overflow).toBe('visible');
});

test('the map takes no pointers behind an open menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedAndOpen(page, seed);
  const guideId = await page.evaluate(() => {
    const w = window as unknown as {
      __massimo: {
        stores: { doc: { getState: () => { addGuide: (o: string, off: number) => string } } };
      };
    };
    return w.__massimo.stores.doc.getState().addGuide('horizontal', 120);
  });
  await openMenuOverTheMap(page);

  // Nothing painted on the map is reachable any more: every hit shape carries
  // its own `pointer-events` presentation attribute, which is exactly what the
  // body-level barrier cannot reach.
  const reachable = await page.evaluate(() => {
    const svg = document.querySelector('.canvas-pan-layer > svg')!;
    const hit = (el: Element) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return at !== null && svg.contains(at);
    };
    return {
      guide: hit(document.querySelector('[data-guide-hit]')!),
      polygon: hit(document.querySelector('[data-polygon-id]')!),
    };
  });
  expect(reachable.guide).toBe(false);
  expect(reachable.polygon).toBe(false);

  // And the drag the user actually tried: press on the guide behind the panel
  // and pull. Its offset must not move.
  const box = await page.locator('[data-guide-hit]').first().boundingBox();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(200, y);
  await page.mouse.down();
  await page.mouse.move(200, y + 60, { steps: 6 });
  await page.mouse.up();
  const offset = await page.evaluate((id) => {
    const w = window as unknown as {
      __massimo: {
        stores: { doc: { getState: () => { guides: Record<string, { offset: number }> } } };
      };
    };
    return w.__massimo.stores.doc.getState().guides[id]?.offset;
  }, guideId);
  expect(offset).toBe(120);

  // The barrier lifts with the menu: a marker left behind would kill the map
  // for the rest of the session, which no assertion above would notice.
  await page.keyboard.press('Escape');
  await expect(page.locator('.field-select-panel')).toHaveCount(0);
  await page.mouse.move(200, y);
  await page.mouse.down();
  await page.mouse.move(200, y + 60, { steps: 6 });
  await page.mouse.up();
  expect(
    await page.evaluate((id) => {
      const w = window as unknown as {
        __massimo: {
          stores: { doc: { getState: () => { guides: Record<string, { offset: number }> } } };
        };
      };
      return w.__massimo.stores.doc.getState().guides[id]?.offset;
    }, guideId),
  ).not.toBe(120);
});
