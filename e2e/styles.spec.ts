import { test, expect, type Page } from '@playwright/test';
import { closeSidebar, seedAndOpen, labelCenter, type Seed } from './fixtures';

// Two free-floating labels far apart: g1 is the style source (24px bold),
// g2 the apply target (16px regular). No stations/lines needed.
const twoLabels: Seed = {
  stations: [],
  lines: [],
  textLabels: [
    { id: 'g1', x: -200, y: 0, text: 'Source', fontSize: 24, weight: 700 },
    { id: 'g2', x: 250, y: 150, text: 'Target', fontSize: 16 },
  ],
};

// The Style row is a Radix Select: the trigger button carries the current
// choice as its text, and options exist only while the panel is open.
const styleSelect = (page: Page) => page.getByRole('combobox', { name: 'Style' });
const currentStyleName = (page: Page) => styleSelect(page);
async function pickStyleOption(page: Page, name: string | RegExp): Promise<void> {
  await styleSelect(page).click();
  await page.getByRole('option', { name }).click();
}

// Define "Heading" by example from g1's popover Style dropdown.
async function saveHeadingFromG1(page: Page): Promise<void> {
  const g1 = await labelCenter(page, 'g1');
  await page.mouse.click(g1.x, g1.y);
  await expect(page.locator('.text-label-popover')).toBeVisible();
  await pickStyleOption(page, 'Save style…');
  await page.getByLabel('Style name').fill('Heading');
  await page.getByLabel('Style name').press('Enter');
  await expect(currentStyleName(page)).toHaveText('Heading');
}

test('save a label style, survive reload, apply to another label, override on edit', async ({
  page,
}) => {
  await seedAndOpen(page, twoLabels);
  await saveHeadingFromG1(page);

  // Definition + tag survive a reload (persisted doc).
  await page.reload();
  // g2 sits under the docked editor while the sidebar is open; closing it
  // moves the dock out to the host edge and hands that band back.
  await closeSidebar(page);
  const g1 = await labelCenter(page, 'g1');
  await page.mouse.click(g1.x, g1.y);
  await expect(currentStyleName(page)).toHaveText('Heading');

  // Apply to g2: its Size jumps to the style's 24. (g2 was seeded with the
  // factory look, so the legacy-load adoption pass tagged it "Default".)
  const g2 = await labelCenter(page, 'g2');
  await page.mouse.click(g2.x, g2.y);
  await expect(currentStyleName(page)).toHaveText('Default');
  await pickStyleOption(page, 'Heading');
  await expect(page.getByRole('spinbutton', { name: 'Size' })).toHaveValue(/^24(\.00)?$/);

  // Editing a covered control keeps the style — the divergence is a
  // per-field override: the trigger reads "(edited)" and the Size row grows
  // a red dot that reverts just that field.
  const size = page.getByRole('spinbutton', { name: 'Size' });
  await size.fill('30');
  await size.press('Enter');
  await expect(currentStyleName(page)).toHaveText('Heading (edited)');
  await page.getByRole('button', { name: 'Revert Size to style' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Size' })).toHaveValue(/^24(\.00)?$/);
  await expect(currentStyleName(page)).toHaveText('Heading');
});

test('the sidebar Styles tab lists, renames, edits live, and deletes styles', async ({ page }) => {
  await seedAndOpen(page, twoLabels);
  await saveHeadingFromG1(page);

  // The sidebar is open by default; the tab counts the six factory Defaults +
  // the pruned stopDot seed MINUS the hidden reserved "None" (1 = Filled black) +
  // the one saved style = 8.
  await page.getByRole('button', { name: 'Styles (8)' }).click();
  await page.getByRole('button', { name: 'Rename Heading' }).click();
  await page.getByLabel('Style name').fill('Header');
  await page.getByLabel('Style name').press('Enter');
  await expect(page.getByRole('button', { name: 'Rename Header' })).toBeVisible();

  // Expand the style's editor and change its Size: the tagged label follows
  // live — its popover (still open for g1) keeps showing the style and its
  // own Size control reads the new value.
  await page.getByRole('button', { name: 'Edit Header' }).click();
  const editor = page.locator('.style-editor');
  const popover = page.locator('.text-label-popover');
  await expect(editor.getByRole('slider', { name: 'Size' })).toHaveAttribute(
    'aria-valuenow',
    '24',
  );
  await editor.getByRole('spinbutton', { name: 'Size' }).fill('30');
  await expect(currentStyleName(page)).toHaveText('Header');
  await expect(popover.getByRole('spinbutton', { name: 'Size' })).toHaveValue(/^30/);

  // Delete: the def goes, the tagged label keeps its look but reads Custom.
  await page.getByRole('button', { name: 'Delete Header' }).click();
  await expect(page.getByRole('button', { name: 'Rename Header' })).not.toBeVisible();
  await expect(currentStyleName(page)).toHaveText('Custom');
});

test('a new label is created wearing the (redefined) Default style', async ({ page }) => {
  await seedAndOpen(page, twoLabels);

  // Redefine the Default LABEL style to 32px via the panel editor. The kind
  // sections render in a fixed order (Lines, Stop dots, Stations, Labels, …);
  // the Stop dots library has no style NAMED "Default", so the "Edit Default"
  // chevrons are Lines (0), Stations (1), Labels (2) — Labels is nth(2).
  await page.getByRole('button', { name: 'Styles (7)' }).click();
  await page.getByRole('button', { name: 'Edit Default' }).nth(2).click();
  const editor = page.locator('.style-editor');
  await editor.getByRole('spinbutton', { name: 'Size' }).fill('32');
  // Collapse the editor so its controls can't shadow the popover's below.
  await page.getByRole('button', { name: 'Edit Default' }).nth(2).click();

  // Drop a new label on empty canvas (clear of the two seeded labels): it
  // comes in at 32 and reads Default.
  // exact — the name matches as a SUBSTRING, and the Styles tab (open here)
  // carries an "Add a color to <palette>" button per palette.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Label' }).click();
  await page.mouse.click(500, 550);
  await expect(page.locator('[data-text-label-id]')).toHaveCount(3);
  const popover = page.locator('.text-label-popover');
  await expect(popover).toBeVisible();
  await expect(currentStyleName(page)).toHaveText('Default');
  await expect(popover.getByRole('spinbutton', { name: 'Size' })).toHaveValue(/^32/);
});
