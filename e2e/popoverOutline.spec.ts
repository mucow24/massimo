import { test, expect, type Locator } from '@playwright/test';
import { seedAndOpen, fourInLineWithBulletsAndLabel, bulletCenter, labelCenter } from './fixtures';

// Every canvas popover is one of two CSS shells: `.bullet-popover` (route
// bullet, polygon, svg image) or `.text-label-popover`. Their signature 3px
// black border vanishes against a black canvas, so a 1px white outline rings
// the border to keep the popover's edge visible.
const WHITE_OUTLINE = { width: '1px', style: 'solid', color: 'rgb(255, 255, 255)' };

async function outlineOf(popover: Locator) {
  return await popover.evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor };
  });
}

test.describe('canvas popover outline', () => {
  test('route-bullet and text-label popovers carry a 1px white outline', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    // Route bullet → `.bullet-popover` shell (shared by polygon + svg image).
    const b1 = await bulletCenter(page, 'b1');
    await page.mouse.click(b1.x, b1.y);
    const bullet = page.locator('.bullet-popover');
    await expect(bullet).toBeVisible();
    expect(await outlineOf(bullet)).toEqual(WHITE_OUTLINE);

    // Text label → `.text-label-popover` shell.
    const g1 = await labelCenter(page, 'g1');
    await page.mouse.click(g1.x, g1.y);
    const label = page.locator('.text-label-popover');
    await expect(label).toBeVisible();
    expect(await outlineOf(label)).toEqual(WHITE_OUTLINE);
  });
});
