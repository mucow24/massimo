import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, clickAtWithModifiers, fourInLine, type Seed } from './fixtures';

// Canvas-only line editing (Edit Stops): the cursor model. Click stations to
// connect from the cursor, click a segment to arm insertion into that edge,
// alt-click to create a station as the action's second click, right-click to
// remove, Esc/canvas-click to back out one level. The old inspector tree is
// gone — these flows ARE the line editor.

const stripe = (page: Page) => page.locator('[data-band-stripe][data-line-id="L1"]').first();

// Clicking a stripe goes STRAIGHT into Edit Stops (there is no selected-but-
// not-editing state, and no Edit Stops button). The banner is the mode signal.
async function openEditStops(page: Page): Promise<void> {
  await stripe(page).click({ force: true });
  await expect(page.locator('.append-banner')).toBeVisible();
}
const editing = (page: Page) => page.locator('.append-banner');

// Page point on the corridor between two stations, biased toward `a` (t from
// a → b). Bias picks the armed edge's march direction deterministically.
async function segPoint(page: Page, a: string, b: string, t = 0.5) {
  const pa = await stationCenter(page, a);
  const pb = await stationCenter(page, b);
  return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
}

async function readLine(page: Page): Promise<{ stations: string[]; edges: string[] }> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    if (!raw) return { stations: [], edges: [] };
    const lines = JSON.parse(raw).state.lines as Record<
      string,
      { stations: string[]; edges: string[] }
    >;
    const l = lines.L1;
    return l ? { stations: l.stations, edges: l.edges ?? [] } : { stations: [], edges: [] };
  });
}

// fourInLine plus two free stations below the row, not on any line.
const withFreeStations: Seed = {
  stations: [
    ...fourInLine.stations,
    { id: 'S', name: 'S', x: 0, y: 150, stops: [] },
    { id: 'T', name: 'T', x: 60, y: 220, stops: [] },
  ],
  lines: fourInLine.lines,
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test('segment click + station click splices the station into that edge', async ({ page }) => {
  await seedAndOpen(page, withFreeStations);
  await openEditStops(page);

  // Arm the B–C edge (click biased toward B → march toward C)...
  const p = await segPoint(page, 'B', 'C', 0.25);
  await page.mouse.click(p.x, p.y);
  // ...then click the free station S: it splices between B and C.
  const s = await stationCenter(page, 'S');
  await page.mouse.click(s.x, s.y);

  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|B', 'B|S', 'C|S', 'C|D']));
  // Still editing.
  await expect(editing(page)).toBeVisible();
});

test('the edge cursor marches: two clicks subdivide the same corridor in order', async ({
  page,
}) => {
  await seedAndOpen(page, withFreeStations);
  await openEditStops(page);

  const p = await segPoint(page, 'B', 'C', 0.25); // near B → to = C
  await page.mouse.click(p.x, p.y);
  const s = await stationCenter(page, 'S');
  await page.mouse.click(s.x, s.y); // B–S, S–C; cursor stays armed on S→C
  const t = await stationCenter(page, 'T');
  await page.mouse.click(t.x, t.y); // splices S–C → S–T, T–C

  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|B', 'B|S', 'S|T', 'C|T', 'C|D']));
});

test('station cursor connects member to member (loop close) and advances', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const a = await stationCenter(page, 'A');
  await page.mouse.click(a.x, a.y); // cursor on A
  const d = await stationCenter(page, 'D');
  await page.mouse.click(d.x, d.y); // wire A–D

  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|B', 'B|C', 'C|D', 'A|D']));
});

test('alt-click creates a station and connects it from the cursor in one undo entry', async ({
  page,
}) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const d = await stationCenter(page, 'D');
  await page.mouse.click(d.x, d.y); // cursor on D
  // Well above the station row (still on the canvas — right of D is sidebar).
  await clickAtWithModifiers(page, { x: d.x - 60, y: d.y - 140 }, ['Alt']);

  // A fifth member appears, wired to D.
  await expect.poll(async () => (await readLine(page)).stations.length).toBe(5);
  const line = await readLine(page);
  const fresh = line.stations.find((s) => !['A', 'B', 'C', 'D'].includes(s))!;
  expect(line.edges).toContain(
    fresh < 'D' ? `${fresh}|D` : `D|${fresh}`, // canonical pair key
  );
  await expect(page.locator('[data-station-id]')).toHaveCount(5);

  // One Ctrl+Z removes the station AND its wiring together (asserted via the
  // DOM — a temporal restore doesn't rewrite localStorage until the next
  // tracked edit).
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-station-id]')).toHaveCount(4);
  // Corridors back to the original three: A–B, B–C, C–D.
  await expect(page.locator('[data-band-stripe]')).toHaveCount(3);
});

test('Esc backs out one level: first the cursor, then the editor', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const a = await stationCenter(page, 'A');
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('[data-append-cursor="A"]')).toBeVisible();

  await page.keyboard.press('Escape');
  // Cursor dropped, still editing.
  await expect(page.locator('[data-append-cursor]')).toHaveCount(0);
  await expect(editing(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(editing(page)).toBeHidden();
});

test('Delete removes the armed station and heals the gap', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const b = await stationCenter(page, 'B');
  await page.mouse.click(b.x, b.y); // cursor on B
  await page.keyboard.press('Delete');

  await expect.poll(async () => (await readLine(page)).stations).toEqual(['A', 'C', 'D']);
  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|C', 'C|D']));
  await expect(editing(page)).toBeVisible();
});

test('Delete cuts the armed segment', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const p = await segPoint(page, 'B', 'C');
  await page.mouse.click(p.x, p.y); // arm B–C
  await page.keyboard.press('Delete');

  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|B', 'C|D']));
  await expect(editing(page)).toBeVisible();
});

test('the × chip on the armed segment removes that edge', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const p = await segPoint(page, 'B', 'C');
  await page.mouse.click(p.x, p.y); // arm B–C → chip appears at the midpoint
  const chip = page.locator('[data-append-remove-segment="B|C"]');
  await expect(chip).toBeVisible();
  await chip.click();

  await expect
    .poll(async () => new Set((await readLine(page)).edges))
    .toEqual(new Set(['A|B', 'C|D']));
  await expect(editing(page)).toBeVisible();
});

test('right-click on a station during Edit Stops rotates it (never removes)', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const b = await stationCenter(page, 'B');
  await page.mouse.click(b.x, b.y, { button: 'right' });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('vignelli-map-doc-v1');
        return raw ? (JSON.parse(raw).state.stations.B.rotation as number) : -1;
      }),
    )
    .not.toBe(0);
  expect((await readLine(page)).stations).toEqual(['A', 'B', 'C', 'D']); // still a member
  await expect(editing(page)).toBeVisible();
});

test('the × chip beside the cursor station removes it from the line', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const b = await stationCenter(page, 'B');
  await page.mouse.click(b.x, b.y); // cursor on B → chip appears
  const chip = page.locator('[data-append-remove-stop="B"]');
  await expect(chip).toBeVisible();
  await chip.click();

  await expect.poll(async () => (await readLine(page)).stations).toEqual(['A', 'C', 'D']);
  await expect(editing(page)).toBeVisible();
});

test('shift-click cycles a segment style while editing', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const p = await segPoint(page, 'A', 'B');
  await clickAtWithModifiers(page, p, ['Shift']);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('vignelli-map-doc-v1');
        return raw
          ? (JSON.parse(raw).state.lines.L1.segmentStyles ?? {})
          : {};
      }),
    )
    .toEqual({ 'A|B': 'dashed' });
});
