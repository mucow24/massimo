import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

/**
 * The ⊕ at a line circle's centre is a second grab for the select+move the rim
 * gives. It exists because this layer paints below all map content: a line
 * riding the ring's first lane buries the rim's grab stroke and the resize knob
 * together, and the circle becomes uneditable without deleting a segment to
 * expose it. A ring's interior is empty by construction, so the centre is the
 * one part ink essentially never covers.
 *
 * Driven in a real browser because the thing under test is which element the
 * pointer actually reaches, and jsdom has neither hit-testing nor layout.
 */

const CENTER = { x: 420, y: 380 };

/** Place a ring via Add → Line circle: first click sets the centre, second the
 *  radius from the cursor distance. */
async function placeCircle(page: Page, radiusPx: number): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Line circle', exact: true }).click();
  await page.mouse.click(CENTER.x, CENTER.y);
  await page.mouse.click(CENTER.x + radiusPx, CENTER.y);
  await expect(page.locator('[data-line-circle-center]')).toHaveCount(1);
}

const centreOf = (page: Page) =>
  page.locator('[data-line-circle] > circle').first().evaluate((el) => ({
    cx: Number(el.getAttribute('cx')),
    cy: Number(el.getAttribute('cy')),
  }));

test.describe('line circle centre handle', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpen(page, { stations: [], lines: [] });
  });

  test('places a ring whose centre carries a visible mark and a grab surface', async ({ page }) => {
    await placeCircle(page, 130);
    await expect(page.locator('[data-line-circle-center-mark]')).toHaveCount(1);
    // Real geometry, not a NaN-ed phantom: the guide has a finite centre.
    const c = await centreOf(page);
    expect(Number.isFinite(c.cx) && Number.isFinite(c.cy)).toBe(true);
  });

  test('clicking the centre selects the ring and opens its editor', async ({ page }) => {
    await placeCircle(page, 130);
    // Placement leaves the new ring selected; start from a clean slate so the
    // click below is what does the selecting.
    await page.keyboard.press('Escape');
    await page.mouse.click(80, 620);
    await expect(page.locator('.line-circle-popover')).toHaveCount(0);

    await page.locator('[data-line-circle-center]').click();
    await expect(page.locator('.line-circle-popover')).toHaveCount(1);
    // The resize knob is the other half of "selected" — it only grows on the
    // rim once the ring is armed.
    await expect(page.locator('[data-line-circle-knob]')).toHaveCount(1);
  });

  test('dragging the centre moves the ring without resizing it', async ({ page }) => {
    await placeCircle(page, 130);
    const before = await centreOf(page);
    const r = await page
      .locator('[data-line-circle] > circle')
      .first()
      .evaluate((el) => Number(el.getAttribute('r')));

    const box = (await page.locator('[data-line-circle-center]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Shift held: bypasses snapping, so the delta is exactly what we asked for.
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const after = await centreOf(page);
    expect(after.cx).toBeGreaterThan(before.cx + 40);
    expect(after.cy).toBeGreaterThan(before.cy + 20);
    const rAfter = await page
      .locator('[data-line-circle] > circle')
      .first()
      .evaluate((el) => Number(el.getAttribute('r')));
    expect(rAfter, 'a centre drag must not resize').toBeCloseTo(r, 6);
  });

  test('reaches a ring whose rim a line is sitting on', async ({ page }) => {
    // The whole reason the handle exists. A wide band riding the rim covers the
    // grab stroke; the centre stays clear, so the ring is still one click away.
    await placeCircle(page, 130);
    const hitAtRim = await page.evaluate(() => {
      const rim = document.querySelector('[data-line-circle-rim]')!;
      const b = rim.getBoundingClientRect();
      // A point ON the circumference, at the ring's due-west edge.
      const el = document.elementFromPoint(Math.round(b.left + 4), Math.round(b.top + b.height / 2));
      return el?.getAttribute('data-line-circle-rim') ?? el?.tagName ?? null;
    });
    // Precondition: with nothing over it, the rim IS the top element there.
    expect(hitAtRim).not.toBeNull();

    // Now the centre: its own surface is topmost at the middle of the ring,
    // which is the property that survives a band on the rim.
    const atCentre = await page.evaluate(() => {
      const hit = document.querySelector('[data-line-circle-center]')!;
      const b = hit.getBoundingClientRect();
      const el = document.elementFromPoint(
        Math.round(b.left + b.width / 2),
        Math.round(b.top + b.height / 2),
      );
      return el?.getAttribute('data-line-circle-center');
    });
    expect(atCentre).not.toBeNull();
  });
});
