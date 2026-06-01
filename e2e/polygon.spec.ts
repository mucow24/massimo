import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

interface PolygonState {
  id: string;
  vertices: { x: number; y: number }[];
  fill: string;
  stroke: string;
  strokeWidth: number;
}

async function readPolygons(page: Page): Promise<Record<string, PolygonState>> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return {};
    return (JSON.parse(raw).state.polygons ?? {}) as Record<string, PolygonState>;
  });
}

async function onlyPolygon(page: Page): Promise<PolygonState> {
  const polys = await readPolygons(page);
  const ids = Object.keys(polys);
  expect(ids).toHaveLength(1);
  return polys[ids[0]];
}

async function addPolygonAt(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  await page.mouse.click(x, y);
}

const CENTER = { x: 700, y: 400 };

test.describe('Polygon shapes', () => {
  test('Add → Polygon drops a default square under the map content and selects it', async ({
    page,
  }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
    });
    await addPolygonAt(page, CENTER.x, CENTER.y);

    const poly = await onlyPolygon(page);
    expect(poly.vertices).toHaveLength(4);

    // Body is painted before the first station in SVG source order (under all
    // map content).
    const order = await page.evaluate(() => {
      const svg = document.querySelector('.canvas-host svg')!;
      const all = Array.from(svg.querySelectorAll('*'));
      return {
        poly: all.findIndex((el) => el.hasAttribute('data-polygon-id')),
        station: all.findIndex((el) => el.hasAttribute('data-station-id')),
      };
    });
    expect(order.poly).toBeGreaterThanOrEqual(0);
    expect(order.station).toBeGreaterThanOrEqual(0);
    expect(order.poly).toBeLessThan(order.station);

    // Auto-selected: popover + handles + edge "+" buttons are present.
    await expect(page.locator('.polygon-popover')).toBeVisible();
    await expect(page.locator('[data-polygon-vertex]')).toHaveCount(4);
    await expect(page.locator('[data-polygon-edge-add]')).toHaveCount(4);
  });

  test('the popover edits stroke width', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    const slider = page.getByRole('slider', { name: 'Stroke width' });
    await slider.fill('6');
    expect((await onlyPolygon(page)).strokeWidth).toBe(6);
  });

  test('clicking "+" splits an edge; selecting a vertex + Delete removes it (min 3)', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    expect((await onlyPolygon(page)).vertices).toHaveLength(4);

    // Split the first edge → 5 vertices.
    const plus = page.locator('[data-polygon-edge-add="0"]');
    const pb = await plus.boundingBox();
    if (!pb) throw new Error('edge "+" not visible');
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    expect((await onlyPolygon(page)).vertices).toHaveLength(5);

    // Select a vertex handle, press Delete → back to 4.
    const handle = page.locator('[data-polygon-vertex="0"]');
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('vertex handle not visible');
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.keyboard.press('Delete');
    expect((await onlyPolygon(page)).vertices).toHaveLength(4);
  });

  test('right-click rotates the polygon 45°', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    const before = (await onlyPolygon(page)).vertices.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    // Right-click the body center (clear of the corner handles).
    await page.mouse.click(CENTER.x, CENTER.y, { button: 'right' });
    const after = (await onlyPolygon(page)).vertices.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    expect(after).not.toEqual(before);
  });

  test('polygons persist across reload', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    const id = Object.keys(await readPolygons(page))[0];
    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    const polys = await readPolygons(page);
    expect(polys[id]).toBeDefined();
    expect(polys[id].vertices).toHaveLength(4);
  });
});
