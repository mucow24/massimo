import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, type Seed } from './fixtures';

// Two stops on one horizontal line → exactly one band with one stripe and one
// segment-style divider, so the assertions don't have to disambiguate.
const twoStop: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
};

// Foreground stripe path for L1 (the underlay path carries no data attrs).
const stripe = (page: Page) => page.locator('[data-band-stripe][data-line-id="L1"]').first();

// Select the line by clicking its stripe. fill=none fails the visibility
// heuristic, but the stroke captures the click — `force` skips the heuristic
// and the React select handler runs (mirrors e2e/layering.spec's clickStripe).
async function selectLine(page: Page): Promise<void> {
  await stripe(page).click({ force: true });
  // The line inspector (with the color palette + segment dividers) appears.
  await page.locator('.inspector').waitFor();
}

// Regression guard for "presentation edits need a reload". A stripe's color
// and per-segment style are resolved live from the lines map, not baked into
// the memoized geometry, so an inspector edit must repaint the canvas with no
// reload. Both assertions FAIL against the pre-fix build (color is stale; a
// dashed→hatched value change reuses the cached geometry).
test.describe('line presentation repaints live (no reload)', () => {
  test('a color edit recolors the band immediately', async ({ page }) => {
    await seedAndOpen(page, twoStop);
    await expect(stripe(page)).toHaveAttribute('stroke', '#0039A6');

    await selectLine(page);

    // Drive the palette's hidden <input type=color> the way React expects
    // (native value setter + input event), so onChange fires.
    await page.locator('.inspector input[type="color"]').evaluate((el, value) => {
      const proto = window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '#cc1177');

    await expect(stripe(page)).toHaveAttribute('stroke', '#cc1177');
  });

  test('a segment-style edit through to hatched restyles the band immediately', async ({
    page,
  }) => {
    await seedAndOpen(page, twoStop);
    await selectLine(page);

    const divider = page.locator('[data-segment-style-divider]').first();

    // solid → dashed (adds a segmentStyles key; worked even pre-fix).
    await divider.click();
    await expect(stripe(page)).toHaveAttribute('stroke-dasharray', /\d/);

    // dashed → hatched: a value-only change at an existing key. This is the
    // case the stale-geometry memo missed — the stripe must switch to the
    // hatch pattern url without a reload.
    await divider.click();
    await expect(stripe(page)).toHaveAttribute('stroke', /^url\(#hatch/);
  });
});
