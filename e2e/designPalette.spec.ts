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

  // Author a design palette: New design… mints one, its first color set to a
  // gray pair in the editor's sun/moon fields.
  await page.getByRole('button', { name: 'Manage palettes' }).click();
  await page.getByRole('button', { name: 'New design…' }).click();
  await page.getByRole('textbox', { name: 'Palette name' }).press('Enter');
  await page.getByRole('button', { name: 'Add color' }).click();
  await setColor(page, 'Color 1', '#333333');
  await setColor(page, 'Dark mode color 1', '#bbbbbb');
  await page.getByRole('button', { name: 'Back to palettes' }).click();
  await page.getByRole('button', { name: 'Close palettes' }).click();

  // Link the polygon's fill to the swatch from the popover dropdown: the
  // trigger flips from Custom to the swatch's name and the pair pickers fold
  // away; the canvas paints the swatch's day color.
  await page.mouse.click(CENTER.x, CENTER.y);
  await expect(page.locator('.polygon-popover')).toBeVisible();
  const fillTrigger = page.getByRole('combobox', { name: 'Fill color palette color' });
  await fillTrigger.click();
  await page.getByRole('option', { name: '1', exact: true }).click();
  await expect(fillTrigger).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Polygon color', exact: true })).toHaveCount(0);
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

  // Detach: Custom keeps the colors but drops the link — the next palette
  // tweak leaves the polygon alone.
  await fillTrigger.click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await expect
    .poll(async () => 'fillRef' in ((await onlyPolygon(page)) as object))
    .toBe(false);
  await setColor(page, 'New design palette 1', '#aa0000');
  await expect(page.locator('[data-polygon-id]')).toHaveAttribute('fill', '#008800');
});
