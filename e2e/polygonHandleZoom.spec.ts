import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

const EMPTY: { stations: []; lines: [] } = { stations: [], lines: [] };
const CENTER = { x: 700, y: 400 };

async function addPolygonAt(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  await page.mouse.click(x, y);
}

async function handleSize(page: Page, selector: string): Promise<{ w: number; h: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} not visible`);
  return { w: box.width, h: box.height };
}

// The polygon's BODY scales with zoom (it's map content), but the editing
// adornments (vertex handles + edge "+" buttons) must stay a constant SIZE on
// screen so they don't swallow the detail you're editing when zoomed in.
test.describe('Polygon edit handles are a constant screen size across zoom', () => {
  test('vertex handle + edge "+" measure the same in CSS px at zoom 1 and zoom 2', async ({
    page,
  }) => {
    // Zoom 1: place a polygon (auto-selected → handles visible) and measure.
    await seedAndOpen(page, EMPTY, { zoom: 1 });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    const vert1 = await handleSize(page, '[data-polygon-vertex="0"]');
    const plus1 = await handleSize(page, '[data-polygon-edge-add="0"]');

    // Zoom 2: fresh seed resets the doc + selection; place + measure again.
    await seedAndOpen(page, EMPTY, { zoom: 2 });
    await addPolygonAt(page, CENTER.x, CENTER.y);
    const vert2 = await handleSize(page, '[data-polygon-vertex="0"]');
    const plus2 = await handleSize(page, '[data-polygon-edge-add="0"]');

    // Constant on screen (±2px for stroke/anti-aliasing). Before this change the
    // zoom-2 handle rendered ~2× larger, so these diffs were ~10px+.
    expect(Math.abs(vert2.w - vert1.w)).toBeLessThan(2);
    expect(Math.abs(vert2.h - vert1.h)).toBeLessThan(2);
    expect(Math.abs(plus2.w - plus1.w)).toBeLessThan(2);
    expect(Math.abs(plus2.h - plus1.h)).toBeLessThan(2);
  });
});
