import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter } from './fixtures';

// Reads the persisted doc slice we assert on.
async function readState(page: Page): Promise<{
  polygons: Record<string, { vertices: { x: number; y: number }[] }>;
  stations: Record<string, { x: number; y: number }>;
}> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    const s = raw ? JSON.parse(raw).state : {};
    return { polygons: s.polygons ?? {}, stations: s.stations ?? {} };
  });
}

const vertsKey = (vs: { x: number; y: number }[]) =>
  vs.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');

test.describe('Selected items win drag hit-testing over higher-painted items', () => {
  // A large polygon under a single station: the polygon body paints below the
  // station (background band), so at the overlap the station normally wins the
  // pointer. With the polygon SELECTED, its top-z hit proxy must win instead, so
  // dragging the overlap moves the polygon and leaves the station put.
  test('a selected polygon under a station drags the polygon, not the station', async ({
    page,
  }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
      polygons: [
        {
          id: 'p0',
          vertices: [
            { x: -150, y: -150 },
            { x: 150, y: -150 },
            { x: 150, y: 150 },
            { x: -150, y: 150 },
          ],
          fill: '#cfe3f2',
          stroke: '#000000',
        },
      ],
    });

    // Select the polygon by clicking its body well clear of the station (which
    // sits at the center): a point near the bottom-right interior corner.
    const body = page.locator('path[data-polygon-id="p0"]');
    const bb = await body.boundingBox();
    if (!bb) throw new Error('polygon body not visible');
    await page.mouse.click(bb.x + bb.width - 15, bb.y + bb.height - 15);
    await expect(page.locator('.polygon-popover')).toBeVisible();
    // The top-z drag proxy now exists for the selected polygon.
    await expect(page.locator('[data-polygon-hit="p0"]')).toHaveCount(1);

    const before = await readState(page);
    const polyBefore = vertsKey(before.polygons.p0.vertices);
    const stationBefore = { ...before.stations.A };

    // Drag starting at the STATION's center — the overlap region. The station is
    // painted above the polygon body, so without the proxy this would move the
    // station.
    const c = await stationCenter(page, 'A');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 80, c.y + 60, { steps: 5 });
    await page.mouse.up();

    const after = await readState(page);
    // The polygon moved…
    expect(vertsKey(after.polygons.p0.vertices)).not.toBe(polyBefore);
    // …and the station stayed exactly where it was.
    expect(after.stations.A.x).toBeCloseTo(stationBefore.x, 5);
    expect(after.stations.A.y).toBeCloseTo(stationBefore.y, 5);
  });

  // The other proxy types reuse hit mechanisms already proven end-to-end:
  // svg-image / station / closed-polygon are transparent + pointerEvents="all"
  // (the case above); bullet / label are transparent-fill + default
  // pointer-events, the same surface their bodies use in the multi-selection
  // drag specs. The OPEN polygon is the one genuinely distinct surface —
  // pointerEvents="stroke" on a transparent, floored-width stroke corridor — so
  // it gets its own end-to-end proof here.
  test('a selected OPEN polygon under a station drags via its stroke corridor, not the station', async ({
    page,
  }) => {
    await seedAndOpen(page, {
      // Station sits ON the open chain's bottom edge (y = 150).
      stations: [{ id: 'A', name: 'A', x: 0, y: 150, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
      polygons: [
        {
          id: 'p0',
          closed: false,
          // Open chain: top → right → bottom edges (the closing left edge is
          // dropped). A thick stroke makes the body grabbable for the initial
          // select-click.
          vertices: [
            { x: -150, y: -150 },
            { x: 150, y: -150 },
            { x: 150, y: 150 },
            { x: -150, y: 150 },
          ],
          fill: '#cfe3f2',
          stroke: '#000000',
          strokeWidth: 8,
        },
      ],
    });

    // Select the open polygon by clicking its RIGHT edge stroke (x = 150),
    // clear of the station on the bottom edge.
    const body = page.locator('path[data-polygon-id="p0"]');
    const bb = await body.boundingBox();
    if (!bb) throw new Error('open polygon body not visible');
    await page.mouse.click(bb.x + bb.width - 4, bb.y + bb.height / 2);
    await expect(page.locator('.polygon-popover')).toBeVisible();
    await expect(page.locator('[data-polygon-hit="p0"]')).toHaveCount(1);

    const before = await readState(page);
    const polyBefore = vertsKey(before.polygons.p0.vertices);
    const stationBefore = { ...before.stations.A };

    // Drag from the station's center — which lies on the polygon's bottom-edge
    // stroke corridor. The proxy's transparent stroke corridor must win.
    const c = await stationCenter(page, 'A');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 80, c.y + 60, { steps: 5 });
    await page.mouse.up();

    const after = await readState(page);
    expect(vertsKey(after.polygons.p0.vertices)).not.toBe(polyBefore);
    expect(after.stations.A.x).toBeCloseTo(stationBefore.x, 5);
    expect(after.stations.A.y).toBeCloseTo(stationBefore.y, 5);
  });
});
