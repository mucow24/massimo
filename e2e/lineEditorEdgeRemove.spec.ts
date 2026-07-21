import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

// Right-click during Edit Stops is the mouse-only EXIT — it must never remove
// topology, on a segment or anywhere else (removal is the × chip or the
// Delete key, one deliberate step away from the exit gesture). Outside Edit
// Stops the same right-click is inert.

const stripe = (page: Page) => page.locator('[data-band-stripe][data-line-id="L1"]').first();

async function segMid(page: Page, a: string, b: string) {
  const pa = await stationCenter(page, a);
  const pb = await stationCenter(page, b);
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

async function readEdges(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return [];
    const l = JSON.parse(raw).state.lines.L1 as
      | { stations: string[]; edges?: string[] }
      | undefined;
    if (!l) return [];
    // A legacy seed has no `edges` until the app persists a change — the
    // store backfills consecutive pairs on rehydrate, so derive the same here.
    if (l.edges) return l.edges;
    const out: string[] = [];
    for (let i = 0; i < l.stations.length - 1; i++) {
      const [a, b] = [l.stations[i], l.stations[i + 1]].sort();
      out.push(`${a}|${b}`);
    }
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test('right-click on a segment exits Edit Stops without removing the edge', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  // Clicking a stripe goes straight into Edit Stops (no button, no
  // intermediate selected state); the banner is the mode signal.
  await stripe(page).click({ force: true });
  await expect(page.locator('.append-banner')).toBeVisible();

  const p = await segMid(page, 'B', 'C');
  await page.mouse.click(p.x, p.y, { button: 'right' });

  await expect(page.locator('.append-banner')).toBeHidden();
  await page.waitForTimeout(300); // give any (wrong) mutation time to persist
  expect(new Set(await readEdges(page))).toEqual(new Set(['A|B', 'B|C', 'C|D']));
  // The DOM agrees: all three corridors still painted.
  await expect(page.locator('[data-band-stripe]')).toHaveCount(3);
});

test('right-click on a segment outside Edit Stops changes nothing', async ({ page }) => {
  await seedAndOpen(page, fourInLine); // idle: nothing selected, no mode

  const p = await segMid(page, 'B', 'C');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(300); // give any (wrong) mutation time to persist

  expect(new Set(await readEdges(page))).toEqual(new Set(['A|B', 'B|C', 'C|D']));
  await expect(page.locator('.append-banner')).toBeHidden(); // and no mode entered
});
