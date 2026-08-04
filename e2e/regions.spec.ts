import { test, expect } from '@playwright/test';
import { seedAndOpen, type Seed } from './fixtures';

// A perpendicular crossing away from all four stations: horizontal L1 crossed
// by vertical L2 at (200, 0). One overlap face with cover {L1, L2}; default
// winner is the lineOrder front-most (L1 here — seeds list L1 first).
const crossing: Seed = {
  stations: [
    { id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 400, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    {
      id: 'C',
      name: 'C',
      x: 200,
      y: -150,
      stops: [{ lineId: 'L2', row: 0, col: 0, orientation: 'auto-vertical' }],
    },
    {
      id: 'D',
      name: 'D',
      x: 200,
      y: 150,
      stops: [{ lineId: 'L2', row: 0, col: 0, orientation: 'auto-vertical' }],
    },
  ],
  lines: [
    { id: 'L1', service: '1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: '2', color: '#ee352e', stations: ['C', 'D'] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Region layering — click a face to cycle which line shows', () => {
  test('L toggles the mode; overlap faces get outlines and click targets', async ({ page }) => {
    await seedAndOpen(page, crossing);
    await page.keyboard.press('l');
    await expect(page.locator('.canvas-host')).toHaveAttribute('data-uimode', 'layering');
    await expect(page.locator('[data-region-outline]')).toHaveCount(1);
    const target = page.locator('[data-region-target]');
    await expect(target).toHaveCount(1);
    await expect(target).toHaveAttribute('data-line-ids', 'L1,L2');
    await page.keyboard.press('Escape');
    await expect(page.locator('.canvas-host')).toHaveAttribute('data-uimode', 'idle');
    await expect(page.locator('[data-region-outline]')).toHaveCount(0);
  });

  test('click cycles the face to L2, again back to default; right-click goes backward', async ({
    page,
  }) => {
    await seedAndOpen(page, crossing);
    await page.keyboard.press('l');
    const target = page.locator('[data-region-target]');

    // Default (L1 on top): nothing is clipped.
    await expect(page.locator('[data-region-excluded]')).toHaveCount(0);

    // Click → L2 painted on top: L1 (the loser) renders through an exclusion
    // clip with a hole over the face; L2 shows through as its base stroke.
    await target.click({ force: true });
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
    await expect(page.locator('clipPath[data-region-exclude="L1"]')).toHaveCount(1);

    // Click again → wraps back to the default → the assignment is deleted.
    await target.click({ force: true });
    await expect(page.locator('[data-region-excluded]')).toHaveCount(0);

    // Right-click cycles backward: from default straight to L2 again.
    await target.click({ button: 'right', force: true });
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
  });

  test('a painted region survives reload (persisted + rebound on rehydrate)', async ({ page }) => {
    await seedAndOpen(page, crossing);
    await page.keyboard.press('l');
    await page.locator('[data-region-target]').click({ force: true });
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
  });

  test('the assignment follows the crossing when a station drags the line away', async ({
    page,
  }) => {
    await seedAndOpen(page, crossing);
    await page.keyboard.press('l');
    await page.locator('[data-region-target]').click({ force: true });
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
    await page.keyboard.press('Escape');

    // Nudge the whole vertical line right: select C, arrow-nudge it, then D.
    // (Keyboard nudges are ungrouped one-shots — each reconciles inline.)
    for (const sid of ['C', 'D']) {
      await page.locator(`[data-station-id="${sid}"]`).click({ force: true });
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('Escape');
    }
    // The crossing moved 25 world units right; the paint choice must follow
    // (the exclusion clip is still present, over the moved face).
    await expect(page.locator('g[data-region-excluded="L1"]').first()).toBeAttached();
  });

  test('idle-mode click on a painted face selects the line the user SEES', async ({ page }) => {
    await seedAndOpen(page, crossing);
    await page.keyboard.press('l');
    await page.locator('[data-region-target]').click({ force: true });
    await page.keyboard.press('Escape');
    // The loser's stripe is clip-excluded over the face — clipped areas take
    // no pointer events, so a click at the crossing lands on the visible
    // winner's stripe natively. The vertical L2 stripe's bbox center IS the
    // crossing point.
    await page
      .locator('[data-band-stripe][data-line-id="L2"]')
      .click({ force: true, position: undefined });
    // Selecting a line mounts the highlight overlay FOR THAT LINE. The layer
    // carries the id, so name it: a bare `[data-highlight-layer]` count of 1
    // holds whichever line got picked, leaving the entire point of the test —
    // that the clip-excluded loser L1 takes no pointer events and the visible
    // winner L2 is what gets selected — unasserted.
    await expect(page.locator('[data-highlight-layer="L2"]')).toHaveCount(1);
  });
});

test.describe('legacy segmentLayers migration', () => {
  test('a v14 doc carrying segmentLayers loads clean (stripped, zero errors)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.evaluate(() => {
      const doc = {
        stations: {
          A: {
            id: 'A',
            name: 'A',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
          B: {
            id: 'B',
            name: 'B',
            x: 200,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        lines: {
          L1: {
            id: 'L1',
            service: '1',
            name: '1 line',
            color: '#0039A6',
            stations: ['A', 'B'],
            edges: ['A|B'],
            segmentLayers: { 'A|B': 3 },
          },
        },
        lineOrder: ['L1'],
      };
      localStorage.setItem(
        'vignelli-map-doc-v1',
        JSON.stringify({ state: doc, version: 14 }),
      );
    });
    await page.goto('/');
    await page.waitForSelector('.canvas-host svg');
    // The doc renders (strip didn't corrupt anything) with zero console
    // errors; the strip itself is pinned by storeMigrate.test.ts.
    await expect(page.locator('[data-band-stripe][data-line-id="L1"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
