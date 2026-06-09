import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

async function stationWorldPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  return await page.evaluate((sid) => {
    const el = document.querySelector(`[data-station-id="${sid}"]`);
    if (!el) throw new Error(`station ${sid} not in DOM`);
    const t = el.getAttribute('transform') ?? '';
    const m = t.match(/translate\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
    if (!m) throw new Error(`could not parse transform "${t}"`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }, id);
}

// T defines a vertical snap axis at x=0 (auto-vertical stop). D is line-adjacent
// on L1, so dragging D near x=0 snaps its X onto that axis.
const seed: Seed = {
  stations: [
    { id: 'T', name: 'T', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'D', name: 'D', x: 60, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L1', color: '#0039A6', stations: ['D', 'T'] }],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
  await page.evaluate(() => localStorage.removeItem('massimo-snap-prefs-v1'));
});

// The snap engage radius is constant in SCREEN pixels (10px), so its world
// extent shrinks as you zoom in — allowing finer positioning before a snap grabs.
test.describe('Snap engage radius is constant on screen across zoom', () => {
  test('zoom 1: D dragged to 7 world units off the axis snaps onto it', async ({ page }) => {
    await seedAndOpen(page, seed, { zoom: 1 });
    // D starts at world (60,0); drag to world (7,0). At zoom 1, page Δ == world Δ.
    const d = await stationCenter(page, 'D');
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x - 53, d.y, { steps: 12 });
    await page.mouse.up();
    // 7 ≤ 10px radius → snaps to x=0.
    const pos = await stationWorldPos(page, 'D');
    expect(pos.x).toBeCloseTo(0, 1);
  });

  test('zoom 2: D dragged to the same 7 world units off the axis does NOT snap', async ({
    page,
  }) => {
    await seedAndOpen(page, seed, { zoom: 2 });
    // Same world target (7,0). At zoom 2, page Δ = 2 × world Δ → -106px.
    const d = await stationCenter(page, 'D');
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x - 106, d.y, { steps: 12 });
    await page.mouse.up();
    // Screen radius 10px / 2 = 5 world units; 7 > 5 → no snap, X stays ~7.
    const pos = await stationWorldPos(page, 'D');
    expect(pos.x).toBeCloseTo(7, 0);
  });
});
