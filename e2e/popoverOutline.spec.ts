import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  seedAndOpen,
  fourInLineWithBulletsAndLabel,
  bulletCenter,
  labelCenter,
} from './fixtures';

// Every canvas popover is one of two CSS shells: `.bullet-popover` (route
// bullet, polygon, svg image, selection) or `.text-label-popover` (label,
// station). The old 3px-black-border chrome kept its edge visible over a
// black canvas with a 1px white outline; the redesigned panel does that job
// with a hairline border plus the FIRST box-shadow layer — a faint dark
// 1px ring on the light theme, flipped to a faint LIGHT ring in dark mode,
// where a dark panel would otherwise melt into a black canvas.
const LIGHT_RING = 'rgba(0, 0, 0, 0.04) 0px 0px 0px 1px';
const DARK_RING = 'rgba(255, 255, 255, 0.07) 0px 0px 0px 1px';

async function edgeOf(popover: Locator) {
  return await popover.evaluate((el) => {
    const s = getComputedStyle(el);
    return { borderWidth: s.borderTopWidth, borderStyle: s.borderTopStyle, shadow: s.boxShadow };
  });
}

async function expectEdge(popover: Locator, ring: string) {
  const edge = await edgeOf(popover);
  expect(edge.borderStyle).toBe('solid');
  expect(edge.borderWidth).toBe('1px');
  expect(edge.shadow).toContain(ring);
}

const toggleDarkMode = (page: Page) =>
  page.getByRole('button', { name: 'Toggle dark mode' }).click();

test.describe('canvas popover edge ring', () => {
  test('both popover shells carry the hairline border + shadow ring, flipping in dark mode', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    // Route bullet → `.bullet-popover` shell (shared by polygon + svg image).
    const b1 = await bulletCenter(page, 'b1');
    await page.mouse.click(b1.x, b1.y);
    const bullet = page.locator('.bullet-popover');
    await expect(bullet).toBeVisible();
    await expectEdge(bullet, LIGHT_RING);

    // Dark mode: the ring flips light so the (now dark) panel still
    // separates from a black canvas.
    await toggleDarkMode(page);
    await expectEdge(bullet, DARK_RING);
    await toggleDarkMode(page);

    // Text label → `.text-label-popover` shell.
    const g1 = await labelCenter(page, 'g1');
    await page.mouse.click(g1.x, g1.y);
    const label = page.locator('.text-label-popover');
    await expect(label).toBeVisible();
    await expectEdge(label, LIGHT_RING);
    await toggleDarkMode(page);
    await expectEdge(label, DARK_RING);
  });
});
