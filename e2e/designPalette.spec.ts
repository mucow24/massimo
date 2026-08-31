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

/** One palette by name, straight from the doc — what the save just wrote. */
const paletteNamed = (page: Page, name: string): Promise<unknown> =>
  page.evaluate((wanted) => {
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
    return w.__massimo.stores.doc.getState().palettes.find((p) => p.name === wanted) ?? null;
  }, name);

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
  const fillTrigger = page.getByRole('button', { name: 'Fill color palette color' });
  await fillTrigger.click();
  await page.getByRole('menuitemradio', { name: '1', exact: true }).click();
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
  await page.getByRole('menuitemradio', { name: 'Custom', exact: true }).click();
  await expect
    .poll(async () => 'fillRef' in ((await onlyPolygon(page)) as object))
    .toBe(false);
  await setColor(page, 'New design palette 1', '#aa0000');
  // Holding the color it had when it detached — the sync above left it there.
  await expect(page.locator('[data-polygon-id]')).toHaveAttribute('fill', '#112233');

  // Save the detached color back into a palette, through the flyout and the
  // two name fields the mint asks for. A REAL pointer is the point: jsdom's
  // zero-size layout defeats Radix's hover-grace polygon, so moving from the
  // sub trigger onto a flyout item closes the flyout there and the unit tests
  // drive this by keyboard instead. The chain's focus hand-off is only truly
  // exercised here too — the second field mounts where the first one stood.
  await fillTrigger.click();
  await page.getByRole('menuitem', { name: 'Save color to palette' }).click();
  await page.getByRole('menuitem', { name: 'New palette…' }).click();

  // The map already carries "New design palette", so the mint counts past it.
  const paletteName = page.getByRole('textbox', { name: 'Palette name' });
  await expect(paletteName).toBeFocused();
  await expect(paletteName).toHaveValue('New design palette 2');
  await paletteName.fill('Brand');
  await paletteName.press('Enter');

  const colorName = page.getByRole('textbox', { name: 'Color name' });
  await expect(colorName).toBeFocused();
  // The stem is the swatch's ARIA label ("Polygon color"), not the row's
  // visible one ("Fill color") — four sites label the row just "Color".
  await expect(colorName).toHaveValue('Polygon color');
  await colorName.fill('Signal');
  await colorName.press('Enter');

  // One gesture, both halves: the palette exists carrying the one color, and
  // the field arrives linked to it — faithful, so no revert badge on a color
  // that has only just been saved.
  await expect.poll(() => paletteNamed(page, 'Brand')).toEqual({
    name: 'Brand',
    kind: 'design',
    // BOTH halves: the polygon's night side was never touched by the recolors
    // above, and the swatch takes the pair the field paints, not its day half.
    swatches: [{ name: 'Signal', color: '#112233', night: '#bbbbbb' }],
  });
  expect(await onlyPolygon(page)).toMatchObject({
    fill: '#112233',
    fillRef: { palette: 'Brand', swatch: 'Signal' },
  });
  await expect(fillTrigger).toHaveText('Signal');
  await expect(page.getByRole('button', { name: /^Reset fill/ })).toHaveCount(0);
});

// The palette-color menu is as long as the map's design palettes are, and only
// its swatch list may scroll — the foot (Custom / Save color to palette) has to
// stay on screen however many swatches sit above it. This is a LAYOUT fact
// jsdom cannot see: the scroll depends on the whole flex chain from the capped
// panel down to `.palette-color-scroll`, and one unshrinkable div in the middle
// silently turns the cap into overflow that runs off the window.
test('a long swatch list scrolls inside the palette-color menu, foot rows reachable', async ({
  page,
}) => {
  await seedAndOpen(page, {
    stations: [],
    lines: [],
    palettes: [
      {
        name: 'Big',
        kind: 'design',
        // Enough rows to overflow the 720px viewport more than twice over.
        swatches: Array.from({ length: 40 }, (_, i) => ({
          name: `C${i + 1}`,
          color: `#0000${(17 * (i % 15)).toString(16).padStart(2, '0')}`,
        })),
      },
      // Enough palettes that the Save flyout overflows the window too.
      ...Array.from({ length: 30 }, (_, i) => ({
        name: `P${i + 1}`,
        kind: 'design' as const,
        swatches: [{ name: '1', color: '#446688' }],
      })),
    ],
  });

  // A polygon's popover carries the Fill palette dropdown.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  await page.mouse.click(CENTER.x, CENTER.y);
  await expect(page.locator('.polygon-popover')).toBeVisible();

  await page.getByRole('button', { name: 'Fill color palette color' }).click();

  // The panel is capped to the window: the foot's Save row sits inside it.
  const save = page.getByRole('menuitem', { name: 'Save color to palette' });
  await expect(save).toBeVisible();
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  // And the cap turned into a real scroll on the swatch list, not a clip.
  const scroll = await page
    .locator('.palette-color-scroll')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scroll.clientHeight).toBeGreaterThan(0);
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

  // The tail is reachable: pick the last swatch (auto-scrolled into view).
  await page.getByRole('menuitemradio', { name: 'C40', exact: true }).click();
  expect(await onlyPolygon(page)).toMatchObject({
    fillRef: { palette: 'Big', swatch: 'C40' },
  });

  // And so is creating a new color from the foot — including when the Save
  // flyout itself lists more palettes than the window is tall: the sub-panel
  // is capped to the window and scrolls, so its own foot (New palette…) is
  // reachable. Unlike the swatch menu there is no always-visible foot here —
  // the whole flyout scrolls — so the pin is the PANEL fitting the viewport
  // plus the foot row answering a click (which auto-scrolls to it).
  await page.getByRole('button', { name: 'Fill color palette color' }).click();
  await save.click();
  const mint = page.getByRole('menuitem', { name: 'New palette…' });
  await expect(mint).toBeVisible();
  const panel = (await page.locator('.menu-sub-panel').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const sub = await page
    .locator('.menu-sub-panel')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(sub.scrollHeight).toBeGreaterThan(sub.clientHeight);
  await mint.click();
  await expect(page.getByRole('textbox', { name: 'Palette name' })).toBeVisible();
  await page.keyboard.press('Escape');
});
