import { test, expect, type Page } from '@playwright/test';
import {
  bulletCenter,
  clickAtWithModifiers,
  labelCenter,
  seedAndOpen,
  stationCenter,
  type Seed,
} from './fixtures';

// End-to-end coverage for the unified snapping contract: the Shift bypass
// (load-bearing in every group-drag spec but never asserted before), the
// bullet/label/polygon snap paths, snap guides, and placement parity.

const DOC_KEY = 'vignelli-map-doc-v1';

async function readStation(page: Page, id: string): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ([key, sid]) => JSON.parse(localStorage.getItem(key)!).state.stations[sid],
    [DOC_KEY, id] as const,
  );
}

async function readBullet(page: Page, id: string): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ([key, bid]) => JSON.parse(localStorage.getItem(key)!).state.routeBullets[bid],
    [DOC_KEY, id] as const,
  );
}

async function readPolygonVertices(page: Page, id: string): Promise<{ x: number; y: number }[]> {
  return await page.evaluate(
    ([key, pid]) => JSON.parse(localStorage.getItem(key)!).state.polygons[pid].vertices,
    [DOC_KEY, id] as const,
  );
}

async function readStationsExcept(page: Page, id: string): Promise<{ x: number; y: number }[]> {
  return await page.evaluate(
    ([key, skip]) =>
      (
        Object.values(JSON.parse(localStorage.getItem(key)!).state.stations) as {
          id: string;
          x: number;
          y: number;
        }[]
      )
        .filter((st) => st.id !== skip)
        .map((st) => ({ x: st.x, y: st.y })),
    [DOC_KEY, id] as const,
  );
}

// Page coords of world (0, 0): the default e2e camera CENTERS the world
// origin at zoom 1 (viewBox = x − w/2 … — see viewportMath.viewBoxFor), so
// page = svgCenter + world.
async function worldOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.canvas-host svg').boundingBox();
  if (!box) throw new Error('canvas svg not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Vertical line A(0,-100) — B(0,0) — C(0,100): the snap axis at every station
// is +y, so a small horizontal nudge on B snaps x back to 0 unless bypassed.
const verticalLine: Seed = {
  stations: [
    { id: 'A', name: 'A', x: 0, y: -100, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'C', name: 'C', x: 0, y: 100, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C'] }],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('massimo-snap-prefs-v1'));
});

// Cycle "Snap to all" from off to the given directional state.
async function setSnapAll(page: Page, state: 'horizontal' | 'vertical'): Promise<void> {
  const btn = page.getByRole('button', { name: 'Snap to all' });
  await btn.click(); // off → horizontal
  if (state === 'vertical') await btn.click(); // horizontal → vertical
  await expect(btn).toHaveAttribute('data-snap-state', state);
}

test.describe('Shift bypasses snapping', () => {
  test('a station drag with Shift held lands raw where the same drag would snap', async ({
    page,
  }) => {
    await seedAndOpen(page, verticalLine);
    const b = await stationCenter(page, 'B');
    await page.keyboard.down('Shift');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 3, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Line snap would pull x back to 0 (companion test); Shift keeps the raw +5.
    const pos = await readStation(page, 'B');
    expect(pos.x).toBeCloseTo(5, 1);
    expect(pos.y).toBeCloseTo(3, 1);
  });

  test('the same drag WITHOUT Shift snaps back onto the line axis', async ({ page }) => {
    await seedAndOpen(page, verticalLine);
    const b = await stationCenter(page, 'B');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 3, { steps: 3 });
    await page.mouse.up();

    const pos = await readStation(page, 'B');
    expect(pos.x).toBeCloseTo(0, 1);
  });
});

test.describe('Route bullet snapping', () => {
  test("a bound bullet drag snaps onto its line's stop axis", async ({ page }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
      routeBullets: [{ id: 'b1', x: 50, y: 50, lineId: 'L1' }],
    });
    const c = await bulletCenter(page, 'b1');
    // World Δ(-46, 0) proposes (4, 50): 4 inside the radius of A's vertical
    // stop axis x=0 → snaps.
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 46, c.y, { steps: 3 });
    await page.mouse.up();

    const b = await readBullet(page, 'b1');
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.y).toBeCloseTo(50, 1);
  });

  test("an UNBOUND bullet aligns to a station stop via 'Snap to all'", async ({ page }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'A', name: 'A', x: 100, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] }],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
      routeBullets: [{ id: 'b1', x: 0, y: 50, lineId: null }],
    });
    await setSnapAll(page, 'vertical');
    const c = await bulletCenter(page, 'b1');
    // World Δ(+103, 0) proposes (103, 50): 3 from the stop's vertical axis
    // x=100 → snaps (previously unbound bullets ignored 'Snap to all').
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 103, c.y, { steps: 3 });
    await page.mouse.up();

    const b = await readBullet(page, 'b1');
    expect(b.x).toBeCloseTo(100, 1);
    expect(b.y).toBeCloseTo(50, 1);
  });
});

test.describe('Text label snapping', () => {
  test('a label drag shows a snap guide while aligned, gone after the drop', async ({ page }) => {
    // Items live LEFT of the canvas center: the sidebar overlays the right
    // half and would swallow the pointer events.
    await seedAndOpen(page, {
      stations: [
        { id: 'A', name: 'A', x: -200, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
      ],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
      textLabels: [{ id: 'g1', x: -300, y: 0 }],
    });
    await setSnapAll(page, 'vertical');
    const c = await labelCenter(page, 'g1');
    // Δ(+117, +50): the label's visible UL corner (center − halfWidth ≈ 20)
    // lands within the engage radius of the stop's vertical axis x=-200.
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 117, c.y + 50, { steps: 3 });

    // The alignment guide renders mid-drag (labels never had guides before).
    // toHaveCount, not toBeVisible: a perfectly vertical guide <line> has a
    // zero-width bounding box, which Playwright treats as invisible.
    await expect(page.locator('[data-snap-guide]')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0);
  });
});

test.describe('Polygon snapping via the shared pool', () => {
  test("a whole-polygon drag aligns its anchor vertex to a bullet center via 'Snap to all'", async ({
    page,
  }) => {
    // Items live LEFT of the canvas center: the sidebar overlays the right
    // half and would swallow the pointer events.
    await seedAndOpen(page, {
      // Coordinate anchor far from the action (also proves stations stay in
      // the pool alongside the new bullet targets).
      stations: [
        { id: 'Z', name: 'Z', x: -500, y: 300, stops: [{ lineId: 'LZ', row: 0, col: 0 }] },
      ],
      lines: [{ id: 'LZ', service: 'Z', color: '#A00033', stations: ['Z'] }],
      routeBullets: [{ id: 'b0', x: -240, y: 60, lineId: null }],
      polygons: [
        {
          id: 'P',
          vertices: [
            { x: -340, y: 0 },
            { x: -300, y: 0 },
            { x: -300, y: 40 },
            { x: -340, y: 40 },
          ],
          fill: '#abcdef',
          stroke: '#123456',
        },
      ],
    });
    await setSnapAll(page, 'vertical');
    const o = await worldOrigin(page);
    // Grab the body at world (-320, 20); Δ(+97, +5) proposes the anchor
    // vertex (-340, 0) at (-243, 5): 3 from the bullet's vertical axis
    // x=-240 → snaps (polygons could not target bullets before the shared
    // pool).
    await page.mouse.move(o.x - 320, o.y + 20);
    await page.mouse.down();
    await page.mouse.move(o.x - 320 + 97, o.y + 20 + 5, { steps: 3 });
    await page.mouse.up();

    const verts = await readPolygonVertices(page, 'P');
    expect(verts[0].x).toBeCloseTo(-240, 1);
    expect(verts[0].y).toBeCloseTo(5, 1);
  });
});

test.describe('Placement parity', () => {
  test('station placement grid-snaps the drop, and Shift-click bypasses it', async ({ page }) => {
    await seedAndOpen(page, {
      stations: [{ id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'LB', row: 0, col: 0 }] }],
      lines: [{ id: 'LB', service: 'B', color: '#A00033', stations: ['B'] }],
    });
    // Isolate the grid: line off, grid 'both'.
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click();
    await gridBtn.click();
    await gridBtn.click();
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'both');

    // Enter placing-station mode via the Add menu.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Stations', exact: true }).click();

    const o = await worldOrigin(page);
    // Clicks land LEFT of center — the sidebar overlays the right half.
    // Click at world (-383, 63) → grid-snaps to (-380, 60).
    await page.mouse.click(o.x - 383, o.y + 63);
    // Shift-click at world (-333, 87) → raw (previously impossible off-grid).
    await clickAtWithModifiers(page, { x: o.x - 333, y: o.y + 87 }, ['Shift']);

    const placed = await readStationsExcept(page, 'B');
    expect(placed).toHaveLength(2);
    const snapped = placed.find((p) => Math.abs(p.x - -380) < 2);
    const raw = placed.find((p) => Math.abs(p.x - -333) < 2);
    expect(snapped).toBeTruthy();
    expect(snapped!.y).toBeCloseTo(60, 1);
    expect(raw).toBeTruthy();
    expect(raw!.y).toBeCloseTo(87, 1);
  });
});
