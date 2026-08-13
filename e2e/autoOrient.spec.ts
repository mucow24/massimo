import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

async function startAddLine(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Line', exact: true }).click();
  // Banner is the visible signal that append mode is engaged.
  await expect(page.locator('.append-banner')).toBeVisible();
}

async function clickStation(page: Page, id: string): Promise<void> {
  const c = await stationCenter(page, id);
  await page.mouse.click(c.x, c.y);
}

// Stations of the (single) line, read straight from the persisted doc.
async function readLineStations(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return [];
    const lines = JSON.parse(raw).state.lines as Record<string, { stations: string[] }>;
    const all = Object.values(lines);
    return all.length ? all[0].stations : [];
  });
}

async function stationRotation(page: Page, id: string): Promise<number> {
  return await page.evaluate((sid) => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) throw new Error('no persisted doc');
    return JSON.parse(raw).state.stations[sid].rotation as number;
  }, id);
}

// Three free stations (no lines yet) forming an L: a (top) — b — c (east of b).
const lShape: Seed = {
  stations: [
    { id: 'a', name: 'a', x: 0, y: -120, stops: [] },
    { id: 'b', name: 'b', x: 0, y: 0, stops: [] },
    { id: 'c', name: 'c', x: 120, y: 0, stops: [] },
  ],
  lines: [],
};

test.describe('auto-orientation — appending never re-rotates a prior station', () => {
  test('adding a third station leaves the existing corner station untouched', async ({ page }) => {
    await seedAndOpen(page, lShape);
    await startAddLine(page);

    await clickStation(page, 'a'); // line [a]
    await clickStation(page, 'b'); // line [a, b]; b oriented as an endpoint
    await expect.poll(() => readLineStations(page)).toEqual(['a', 'b']);
    const before = await stationRotation(page, 'b');

    await clickStation(page, 'c'); // line [a, b, c]; b is now a corner
    await expect.poll(() => readLineStations(page)).toEqual(['a', 'b', 'c']);
    const after = await stationRotation(page, 'b');

    // The bug: appending c re-rotated the already-placed station b. Honoring
    // "never auto-rotate a station already served by a line", b is unchanged.
    expect(after).toBe(before); // RED on old code: b flips 0 → 7
  });
});
