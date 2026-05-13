import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

const STOP_SIZE = 14;

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

// Target station T with two auto-ne-sw stops at cells (0,0) and (1,1) —
// a diagonal interline group of 2. After compression, T's L1 stop sits at
// world (T.x + shift, T.y + shift) where shift = STOP_SIZE·(√2−1)/2·(√2/2)
// = STOP_SIZE·(2−√2)/4 along the NW-SE perp axis (i.e. SE direction).
//
// Dragged station D has a single L1 stop at cell (0,0) (no compression).
// Drag D so its L1 stop lines up with T's *visible* (compressed) L1 stop —
// the snap solver should resolve to T's compressed world position, not the
// cell-grid position.

const targetCompressionSeed: Seed = {
  stations: [
    {
      id: 'T',
      name: 'T',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-ne-sw' },
        { lineId: 'L2', row: 1, col: 1, orientation: 'auto-ne-sw' },
      ],
    },
    {
      id: 'D',
      name: 'D',
      x: 80,
      y: 80,
      rotation: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-ne-sw' }],
    },
  ],
  lines: [
    { id: 'L1', service: 'L1', color: '#0039A6', stations: ['D', 'T'] },
    { id: 'L2', service: 'L2', color: '#EE352E', stations: ['T'] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
  await page.evaluate(() => localStorage.removeItem('massimo-snap-prefs-v1'));
});

test.describe('Drag-snap aligns with the compressed (visible) target position', () => {
  test('dragging D near T snaps to T\'s compressed L1 position, not its cell-grid position', async ({
    page,
  }) => {
    await seedAndOpen(page, targetCompressionSeed);

    // Compute T's compressed L1 world position. T's L1 cell is at (0, 0)
    // world; with the diagonal pair, L1 shifts toward L2's cell (STOP_SIZE,
    // STOP_SIZE) along the NW-SE perp axis (= SE direction). The shift is
    // STOP_SIZE·(√2−1)/2 perp units, which projects to STOP_SIZE·(√2−1)/2 ·
    // (√2/2, √2/2) in world.
    const shift = (STOP_SIZE * (Math.SQRT2 - 1)) / 2;
    const tL1World = {
      x: shift * Math.SQRT1_2,
      y: shift * Math.SQRT1_2,
    };

    // Drag D so its anchor (and thus its L1 stop, since D's stop is at cell
    // (0,0) with no compression) lands NEAR T's compressed L1 position.
    // Approach a few pixels off-axis to force the snap to engage.
    // D starts at world (80, 80); to bring it to (~5, ~5) (a bit past T's
    // compressed L1 at (~2.05, ~2.05)), drag by world (-75, -75). At zoom 1
    // world delta equals page delta.
    const d = await stationCenter(page, 'D');
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x - 75, d.y - 75, { steps: 12 });
    await page.mouse.up();

    const dPos = await stationWorldPos(page, 'D');
    // D's L1 stop (at cell (0,0) on D) ends up at D's world position.
    // Snap should put D's anchor at T's compressed L1 position.
    expect(dPos.x).toBeCloseTo(tL1World.x, 1);
    expect(dPos.y).toBeCloseTo(tL1World.y, 1);

    // Sanity: D didn't snap to the cell-grid position (0, 0). The compressed
    // position differs from the cell position by ~2.05 units in each axis.
    expect(Math.hypot(dPos.x - 0, dPos.y - 0)).toBeGreaterThan(2);
  });
});
