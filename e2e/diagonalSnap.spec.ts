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

// Target station T has two perp-adjacent auto-ne-sw stops at diagonal-basis
// cells (0,0) and (√2/2, √2/2). Dragged station D has one L1 stop at cell
// (0,0). Snap should align D so D.L1 sits exactly on T.L1's cell-grid world
// position — there is no compression shifting T.L1 off its cell.

const H = Math.SQRT1_2;

const diagonalTargetSeed: Seed = {
  stations: [
    {
      id: 'T',
      name: 'T',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-ne-sw' },
        { lineId: 'L2', row: H, col: H, orientation: 'auto-ne-sw' },
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

test.describe('Drag-snap aligns with the target stop\'s cell-grid position', () => {
  test("dragging D near T snaps D.L1 onto T.L1's cell-grid world position", async ({ page }) => {
    await seedAndOpen(page, diagonalTargetSeed);

    // T.L1 cell is at (0, 0) world. With the heuristic gone, the rendered
    // position is the cell-grid position — nothing else to compute.
    const tL1World = { x: 0, y: 0 };

    // Drag D so its anchor (and thus its L1 stop, since D's stop is at
    // cell (0,0)) lands near T.L1. Approach a few pixels off-axis to force
    // the snap to engage. D starts at world (80, 80); drag by (-75, -75)
    // to bring it to ~(5, 5). At zoom 1, world delta equals page delta.
    const d = await stationCenter(page, 'D');
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x - 75, d.y - 75, { steps: 12 });
    await page.mouse.up();

    const dPos = await stationWorldPos(page, 'D');
    // D's single L1 stop lives at its anchor (cell offset is zero).
    expect(dPos.x).toBeCloseTo(tL1World.x, 1);
    expect(dPos.y).toBeCloseTo(tL1World.y, 1);
  });
});
