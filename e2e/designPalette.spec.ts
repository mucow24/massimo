import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen } from './fixtures';

// The full design-palette journey, one boot: author a design palette in the
// manager, LINK a polygon fill to its swatch from the popover dropdown, tweak
// the swatch from the sidebar Palettes section (the linked polygon follows
// live), then detach via Custom (the polygon stops following).

interface PolygonRead {
  fill: string;
  darkFill: string;
  fillRef?: { palette: string; swatch: string };
}

const onlyPolygon = (page: Page): Promise<PolygonRead> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __massimo: {
        stores: {
          doc: {
            getState: () => { polygons: Record<string, PolygonRead> };
          };
        };
      };
    };
    const polys = w.__massimo.stores.doc.getState().polygons;
    return polys[Object.keys(polys)[0]];
  });

/** The design palette's first swatch, straight from the doc. */
const firstSwatch = (page: Page): Promise<{ name: string; color: string; night?: string }> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __massimo: {
        stores: {
          doc: {
            getState: () => {
              palettes: { name: string; kind?: string; swatches: { name: string; color: string }[] }[];
            };
          };
        };
      };
    };
    const design = w.__massimo.stores.doc
      .getState()
      .palettes.find((p) => p.kind === 'design');
    return design!.swatches[0];
  });

// Clear of the docked popover (see polygon.spec.ts).
const CENTER = { x: 560, y: 400 };

const setColor = async (page: Page, label: string, hex: string) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByLabel(`${label} hex value`).fill(hex);
  await page.keyboard.press('Escape'); // closes the picker only
};

test('design palette: author, link a polygon, tweak from the sidebar, detach', async ({
  page,
}) => {
  await seedAndOpen(page, { stations: [], lines: [] });

  // Drop a polygon to work with.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  await page.mouse.click(CENTER.x, CENTER.y);
  await expect(page.locator('.polygon-popover')).toBeVisible();

  // Author a design palette: New… → New design palette mints one, its first
  // color set to a gray pair in the editor's sun/moon fields.
  await page.getByRole('button', { name: 'Manage palettes' }).click();
  await page.getByRole('button', { name: 'New…' }).click();
  await page.getByRole('menuitem', { name: 'New design palette' }).click();
  await page.getByRole('textbox', { name: 'Palette name' }).press('Enter');
  await page.getByRole('button', { name: 'Add color' }).click();
  await setColor(page, 'Color 1', '#333333');
  await setColor(page, 'Dark mode color 1', '#bbbbbb');
  await page.getByRole('button', { name: 'Back to palettes' }).click();

  // The row's strip is a LAYOUT fact jsdom cannot see: the day/night halves are
  // sized by flex against the strip's band, so a missing stretch collapses them
  // to nothing while every DOM assertion still passes. Pin that they have real
  // height, split the band evenly, and TOUCH.
  const bars = await page
    .locator('.palette-in-map .palette-row')
    .filter({ hasText: 'New design palette' })
    .locator('.palette-dot-pair')
    .first()
    .evaluate((pair) => {
      const [day, night] = [...pair.children].map((c) => c.getBoundingClientRect());
      return { dayH: Math.round(day.height), nightH: Math.round(night.height), seam: night.top - day.bottom };
    });
  expect(bars.dayH).toBeGreaterThan(4);
  expect(bars.nightH).toBe(bars.dayH);
  expect(bars.seam).toBe(0);

  await page.getByRole('button', { name: 'Close palettes' }).click();

  // Link the polygon's fill to the swatch from the popover dropdown: the
  // trigger flips from Custom to the swatch's name and the pickers stay put,
  // now showing the swatch's colors; the canvas paints its day color.
  await page.mouse.click(CENTER.x, CENTER.y);
  await expect(page.locator('.polygon-popover')).toBeVisible();
  const fillTrigger = page.getByRole('combobox', { name: 'Fill color palette color' });
  await fillTrigger.click();
  await page.getByRole('option', { name: '1', exact: true }).click();
  await expect(fillTrigger).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Polygon color', exact: true })).toHaveCount(1);
  expect(await onlyPolygon(page)).toMatchObject({
    fill: '#333333',
    darkFill: '#bbbbbb',
    fillRef: { palette: 'New design palette', swatch: '1' },
  });
  await expect(page.locator('[data-polygon-id]')).toHaveAttribute('fill', '#333333');

  // Tweak the swatch from the sidebar Palettes section — the linked polygon
  // follows live (that is the whole point of the link).
  await page.getByRole('button', { name: /^Styles \(/ }).click();
  await setColor(page, 'New design palette 1', '#008800');
  await expect(page.locator('[data-polygon-id]')).toHaveAttribute('fill', '#008800');
  expect((await onlyPolygon(page)).fill).toBe('#008800');

  // Recolor the LINKED field in place: the link survives (the trigger keeps
  // naming the swatch) and the row grows its two palette controls.
  //
  // The LAYOUT is the point here, and jsdom cannot see it: the revert badge
  // comes and goes as the color diverges and is put back, so its slot has to
  // be held open — otherwise the pickers slide sideways under the cursor on
  // the very click that resets them. Measuring the day swatch's x across all
  // three states is what pins that.
  const daySwatchX = () =>
    page
      .getByRole('button', { name: 'Polygon color', exact: true })
      .evaluate((el) => Math.round(el.getBoundingClientRect().x));

  const xLinkedClean = await daySwatchX();
  await setColor(page, 'Polygon color', '#112233');
  await expect(fillTrigger).toHaveText('1'); // still linked, just diverged
  expect((await onlyPolygon(page)).fillRef).toEqual({
    palette: 'New design palette',
    swatch: '1',
  });
  expect(await daySwatchX()).toBe(xLinkedClean);

  // Reset puts the swatch's own color back, and nothing moves doing it.
  await page.getByRole('button', { name: /^Reset fill/ }).click();
  expect((await onlyPolygon(page)).fill).toBe('#008800');
  expect(await daySwatchX()).toBe(xLinkedClean);

  // Sync sends a local color the other way — into the swatch, so the palette
  // itself (and the sidebar row showing it) lands on what this field paints.
  await setColor(page, 'Polygon color', '#112233');
  await page.getByRole('button', { name: /^Sync fill/ }).click();
  await expect.poll(() => firstSwatch(page)).toMatchObject({ name: '1', color: '#112233' });
  expect((await onlyPolygon(page)).fill).toBe('#112233');
  expect(await daySwatchX()).toBe(xLinkedClean);

  // Still linked after all that — sync moved the swatch, not the link.
  await expect(fillTrigger).toHaveText('1');

  // Detach: Custom keeps the colors but drops the link — the next palette
  // tweak leaves the polygon alone.
  await fillTrigger.click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await expect
    .poll(async () => 'fillRef' in ((await onlyPolygon(page)) as object))
    .toBe(false);
  await setColor(page, 'New design palette 1', '#aa0000');
  // Holding the color it had when it detached — the sync above left it there.
  await expect(page.locator('[data-polygon-id]')).toHaveAttribute('fill', '#112233');
});
