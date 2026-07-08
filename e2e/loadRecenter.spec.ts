import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, fourInLine } from './fixtures';

// A saved map whose content sits far from both the origin and the parked
// camera below, at roughly (5150, 5000).
const LOADED_FILE = JSON.stringify({
  format: 'massimo-map',
  version: 2,
  doc: {
    name: 'Loaded',
    stations: {
      X: {
        id: 'X',
        name: 'Xanadu',
        x: 5000,
        y: 5000,
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
      },
      Y: {
        id: 'Y',
        name: 'Yonkers',
        x: 5300,
        y: 5000,
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
      },
    },
    lines: { L1: { id: 'L1', service: 'L', name: 'L line', color: '#0039A6', stations: ['X', 'Y'] } },
  },
});

// Center of the live SVG's viewBox, in world coords — where the camera points.
async function viewBoxCenter(page: Page): Promise<{ cx: number; cy: number }> {
  const vb = await page.locator('.canvas-host > svg').getAttribute('viewBox');
  const [vx, vy, vw, vh] = vb!.split(/\s+/).map(Number);
  return { cx: vx + vw / 2, cy: vy + vh / 2 };
}

test('opening a map file recenters the camera onto the loaded content', async ({ page }) => {
  // Seed any doc, but park the camera far away so the canvas starts blank —
  // exactly the "load to an empty screen" case this feature fixes.
  await seedAndOpen(page, fourInLine, { x: 100000, y: 100000, zoom: 1 });

  const before = await viewBoxCenter(page);
  expect(before.cx).toBeGreaterThan(50000); // still parked far away
  expect(before.cy).toBeGreaterThan(50000);

  // Load the file (the hidden loader input is the one accepting .massimo).
  await page.locator('input[accept*="massimo"]').setInputFiles({
    name: 'loaded.massimo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(LOADED_FILE),
  });

  // The loaded station must actually be in the DOM (proves the file parsed).
  await expect(page.locator('[data-station-id="X"]')).toHaveCount(1);

  // The camera followed the content: its viewBox now centers on ~(5150, 5000),
  // not the parked (100000, 100000).
  await expect
    .poll(async () => (await viewBoxCenter(page)).cx)
    .toBeLessThan(10000);
  const after = await viewBoxCenter(page);
  expect(after.cx).toBeGreaterThan(4600);
  expect(after.cx).toBeLessThan(5700);
  expect(after.cy).toBeGreaterThan(4500);
  expect(after.cy).toBeLessThan(5500);

  // And the loaded station renders inside the SVG's on-screen rectangle.
  const host = await page.locator('.canvas-host > svg').boundingBox();
  const dot = await page.locator('[data-station-id="X"]').boundingBox();
  expect(dot).not.toBeNull();
  expect(host).not.toBeNull();
  const dotCx = dot!.x + dot!.width / 2;
  const dotCy = dot!.y + dot!.height / 2;
  expect(dotCx).toBeGreaterThanOrEqual(host!.x);
  expect(dotCx).toBeLessThanOrEqual(host!.x + host!.width);
  expect(dotCy).toBeGreaterThanOrEqual(host!.y);
  expect(dotCy).toBeLessThanOrEqual(host!.y + host!.height);
});
