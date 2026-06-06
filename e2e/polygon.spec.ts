import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

interface PolygonState {
  id: string;
  vertices: { x: number; y: number }[];
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillOpacity?: number;
  locked?: boolean;
  curveRadius?: number;
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

  test('the popover sets a curve radius that rounds the body into a path with curves', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);

    const slider = page.getByRole('slider', { name: 'Curve radius' });
    await slider.fill('20');
    expect((await onlyPolygon(page)).curveRadius).toBe(20);

    // The body is a <path> whose `d` contains quadratic curves once rounded.
    const d = await page.locator('path[data-polygon-id]').first().getAttribute('d');
    expect(d).toContain('Q');
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

async function polygonOrder(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    return raw ? (JSON.parse(raw).state.polygonOrder ?? []) : [];
  });
}

async function domPolygonIds(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('polygon[data-polygon-id]')).map((el) =>
      el.getAttribute('data-polygon-id'),
    ),
  );
}

test.describe('Polygon opacity, layering, placement, lock', () => {
  test('the fill-opacity slider drives the body fill-opacity', async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    await page.getByRole('slider', { name: 'Fill opacity' }).fill('40');
    const opacity = await page.evaluate(() =>
      document.querySelector('polygon[data-polygon-id]')?.getAttribute('fill-opacity'),
    );
    expect(Number(opacity)).toBeCloseTo(0.4, 5);
  });

  test('Move down reorders the polygon paint order (DOM matches polygonOrder)', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, 600, 400);
    await addPolygonAt(page, 640, 430); // second polygon, now selected (popover open)
    const before = await polygonOrder(page);
    expect(before).toHaveLength(2);
    // The selected (second) polygon is on top; send it to the back.
    await page.getByRole('button', { name: 'Move polygon down' }).click();
    const after = await polygonOrder(page);
    expect(after).toEqual([before[1], before[0]]);
    // Body paint order in the DOM matches the stored order (later = on top).
    expect(await domPolygonIds(page)).toEqual(after);
  });

  test('a starter-square ghost follows the cursor before placement, then resolves to the polygon', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
    // Move (no click): the semitransparent ghost appears and is centered on
    // the cursor; no real polygon exists yet.
    await page.mouse.move(CENTER.x, CENTER.y);
    const ghost = page.locator('[data-polygon-preview]');
    await expect(ghost).toHaveCount(1);
    await expect(ghost).toHaveAttribute('opacity', '0.5');
    expect(Object.keys(await readPolygons(page))).toHaveLength(0);
    // Click places it; single-shot mode exits, so the ghost is gone and a real
    // polygon remains.
    await page.mouse.click(CENTER.x, CENTER.y);
    await expect(page.locator('[data-polygon-preview]')).toHaveCount(0);
    expect(Object.keys(await readPolygons(page))).toHaveLength(1);
  });

  test('a click-to-place tool places through a polygon instead of selecting it', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    // Enter "place station" mode (clears the polygon selection), then click
    // inside the polygon body.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Stations', exact: true }).click();
    await page.mouse.click(CENTER.x, CENTER.y);
    // A station was placed, and the polygon was NOT selected.
    const stationCount = await page.evaluate(() => {
      const raw = localStorage.getItem('vignelli-map-doc-v1');
      return raw ? Object.keys(JSON.parse(raw).state.stations ?? {}).length : 0;
    });
    expect(stationCount).toBe(1);
    await expect(page.locator('.polygon-popover')).toHaveCount(0);
  });

  test('locking hides edit handles and prevents dragging; unlocking restores them', async ({
    page,
  }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    // Lock it.
    await page.getByRole('button', { name: 'Lock polygon' }).click();
    expect((await onlyPolygon(page)).locked).toBe(true);
    await expect(page.locator('[data-polygon-vertex]')).toHaveCount(0);
    await expect(page.locator('[data-polygon-edge-add]')).toHaveCount(0);

    // Dragging the locked body does nothing.
    const before = JSON.stringify((await onlyPolygon(page)).vertices);
    await page.mouse.move(CENTER.x, CENTER.y);
    await page.mouse.down();
    await page.mouse.move(CENTER.x + 60, CENTER.y + 40, { steps: 4 });
    await page.mouse.up();
    expect(JSON.stringify((await onlyPolygon(page)).vertices)).toBe(before);

    // Unlock → handles return.
    await page.getByRole('button', { name: 'Unlock polygon' }).click();
    await expect(page.locator('[data-polygon-vertex]')).toHaveCount(4);
  });
});
