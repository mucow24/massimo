import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

// The label-offset number boxes accept NEGATIVE values — the slider beside each
// one spans −100…100, so half its range is only reachable by typing.
//
// This needs a real browser, not jsdom. A lone "-" is not a valid
// floating-point number, so a number input reports its value as '' while
// holding "-" in its raw buffer. A controlled input bound straight to a NUMBER
// then sees ''≠"0" and writes "0" back over the raw buffer, so typing "-5"
// leaves the box reading "05". jsdom does not reproduce that restore, which is
// why the unit tests never saw it.
//
// Both offsets (along / perpendicular to the reading direction) use the same
// control and carry the same aria-label, hence the index.
const OFFSET = (page: Page, which: 0 | 1) =>
  page.getByRole('spinbutton', { name: 'Offset value' }).nth(which);

async function selectStationA(page: Page): Promise<void> {
  const c = await stationCenter(page, 'A');
  await page.mouse.click(c.x, c.y);
  await page.locator('.inspector').waitFor();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Label offset textbox', () => {
  test('a negative value can be typed', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await selectStationA(page);

    const box = OFFSET(page, 0);
    await box.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('-5');

    await expect(box).toHaveValue('-5');
    await box.blur();
    await expect(box).toHaveValue('-5');
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('vignelli-map-doc-v1');
        return raw ? JSON.parse(raw).state.stations.A.label.offset : null;
      }),
    ).toBe(-5);
  });

  test('a positive value still commits (control)', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await selectStationA(page);

    const box = OFFSET(page, 0);
    await box.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('7');

    await expect(box).toHaveValue('7');
  });

  test('the perpendicular offset takes a negative value too', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await selectStationA(page);

    const box = OFFSET(page, 1);
    await box.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('-12');

    await expect(box).toHaveValue('-12');
  });
});
