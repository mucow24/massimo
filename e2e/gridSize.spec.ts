import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

// Parse a station's world position out of its <g transform="translate(x y)">.
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

async function readPolygonVertices(page: Page, id: string): Promise<{ x: number; y: number }[]> {
  return await page.evaluate((pid) => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return [];
    return (JSON.parse(raw).state.polygons?.[pid]?.vertices ?? []) as { x: number; y: number }[];
  }, id);
}

// A lone station at the world origin: no neighbors, so with line off the grid
// hard-constraint is the only thing that can move it — deterministic snapping.
const loneStation: Seed = {
  stations: [{ id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'LB', row: 0, col: 0 }] }],
  lines: [{ id: 'LB', service: 'B', color: '#A00033', stations: ['B'] }],
};

test.beforeEach(async ({ page }) => {
  // Snap prefs persist across tests; reset so each test starts from defaults
  // (line on, grid off). The grid SIZE lives in massimo-viewport, which
  // seedAndOpen rewrites without a gridSize each run → defaults back to 10px.
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('massimo-snap-prefs-v1'));
});

test.describe('grid size toggle', () => {
  test('button cycles 10 → 20 → 5 and persists across reload', async ({ page }) => {
    await seedAndOpen(page, loneStation);
    const sizeBtn = page.getByRole('button', { name: 'Cycle grid size' });

    await expect(sizeBtn).toHaveText('10');
    await expect(sizeBtn).toHaveAttribute('data-grid-size', '10');

    await sizeBtn.click(); // 10 → 20
    await expect(sizeBtn).toHaveText('20');
    await sizeBtn.click(); // 20 → 5
    await expect(sizeBtn).toHaveText('5');
    await expect(sizeBtn).toHaveAttribute('data-grid-size', '5');

    // Persisted to localStorage → still 5 after a reload.
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(page.getByRole('button', { name: 'Cycle grid size' })).toHaveAttribute(
      'data-grid-size',
      '5',
    );
  });

  test('grid density tracks the size: 20px is sparser, 5px is denser than 10px', async ({
    page,
  }) => {
    await seedAndOpen(page, loneStation);
    const verticalCount = () =>
      page.evaluate(() => {
        const svg = document.querySelector('.canvas-host svg')!;
        return Array.from(svg.querySelectorAll('line')).filter(
          (l) => l.getAttribute('x1') === l.getAttribute('x2'),
        ).length;
      });
    const btn = page.getByRole('button', { name: 'Cycle grid size' });
    const at10 = await verticalCount();
    await btn.click(); // 10 → 20
    const at20 = await verticalCount();
    await btn.click(); // 20 → 5
    const at5 = await verticalCount();
    expect(at20).toBeLessThan(at10);
    expect(at5).toBeGreaterThan(at10);
  });

  test('a station drag snaps to the 5px grid, not the 10px grid', async ({ page }) => {
    await seedAndOpen(page, loneStation);
    // Isolate the grid: turn line off, cycle grid to 'both'.
    await page.getByRole('button', { name: 'Snap to line' }).click();
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click(); // off → horizontal
    await gridBtn.click(); // horizontal → vertical
    await gridBtn.click(); // vertical → both
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'both');

    // Cycle the grid to 5px (10 → 20 → 5).
    const sizeBtn = page.getByRole('button', { name: 'Cycle grid size' });
    await sizeBtn.click();
    await sizeBtn.click();
    await expect(sizeBtn).toHaveAttribute('data-grid-size', '5');

    // Drag B by +7,+7. World delta == page delta at zoom 1 → proposed (7,7),
    // which snaps to (5,5) on a 5px grid (it would be (10,10) on a 10px grid).
    const b = await stationCenter(page, 'B');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 7, b.y + 7, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.x).toBeCloseTo(5, 0);
    expect(pos.y).toBeCloseTo(5, 0);
  });

  test('a polygon vertex drag snaps to the 5px grid (usePolygonDrag wiring)', async ({ page }) => {
    // Square with vertex 0 at the world origin.
    await seedAndOpen(page, {
      stations: [],
      lines: [],
      polygons: [
        {
          id: 'P',
          vertices: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
            { x: 0, y: 40 },
          ],
          fill: '#abcdef',
          stroke: '#123456',
        },
      ],
    });

    // Select the polygon so its vertex handles render.
    await page.locator('[data-polygon-id="P"]').first().click();
    await expect(page.locator('[data-polygon-vertex="0"]')).toBeVisible();

    // Isolate the grid: line off, grid 'both', size 5.
    await page.getByRole('button', { name: 'Snap to line' }).click();
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click();
    await gridBtn.click();
    await gridBtn.click();
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'both');
    const sizeBtn = page.getByRole('button', { name: 'Cycle grid size' });
    await sizeBtn.click();
    await sizeBtn.click();
    await expect(sizeBtn).toHaveAttribute('data-grid-size', '5');

    // Grab vertex 0's handle (centered on world origin) and drag +7,+7.
    const handle = page.locator('[data-polygon-vertex="0"]');
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('vertex handle not visible');
    const cx = hb.x + hb.width / 2;
    const cy = hb.y + hb.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 7, cy + 7, { steps: 5 });
    await page.mouse.up();

    const v0 = (await readPolygonVertices(page, 'P'))[0];
    expect(v0.x).toBeCloseTo(5, 0);
    expect(v0.y).toBeCloseTo(5, 0);
  });
});
