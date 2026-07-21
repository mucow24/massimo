import { test, expect, type Page } from '@playwright/test';
import {
  seedAndOpen,
  stationCenter,
  labelCenter,
  clickAtWithModifiers,
  fourInLine,
  type Seed,
} from './fixtures';

// Canvas-only line editing (Edit Stops): the cursor model. Click stations to
// connect from the cursor, click a segment to arm insertion into that edge,
// alt-click to create a station as the action's second click, Delete/× to
// remove, Esc/canvas-click to back out one level, right-click anywhere to
// exit. The old inspector tree is gone — these flows ARE the line editor.

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

// A and B sit 16 world units apart, so the A–B band is fully hidden under their
// two hit rects — a "short segment sandwiched between two stations". C is far
// down the line so its B–C stripe stays easy to click.
const shortSegment: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -8, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 8, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'C', name: 'C', x: 200, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C'] }],
};

// fourInLine plus a text label centred on the B–C corridor (world midpoint
// x≈0, y=0), so its box overlaps the line.
const withLabelOverLine: Seed = {
  ...fourInLine,
  textLabels: [{ id: 'g1', x: 0, y: 0, text: 'Midtown', fontSize: 20, weight: 700 }],
};

// Page-coord centre of a stop dot (precise, unlike the station <g> box which the
// label inflates) — needed when two stations sit close enough to occlude.
async function stopDotCenter(page: Page, sid: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-stop-station="${sid}"]`).first().boundingBox();
  if (!box) throw new Error(`stop dot ${sid} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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

test('the style chip on the armed segment cycles its line style', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  const p = await segPoint(page, 'B', 'C');
  await page.mouse.click(p.x, p.y); // arm B–C → chips appear at the midpoint
  const chip = page.locator('[data-append-cycle-segment-style="B|C"]');
  await expect(chip).toBeVisible();
  await chip.click();

  await expect.poll(async () => await segmentStyles(page)).toEqual({ 'B|C': 'dashed' });
  // The cursor stays armed, so the chip is still there to keep cycling.
  await chip.click();
  await expect.poll(async () => await segmentStyles(page)).toEqual({ 'B|C': 'hatched' });
  await expect(editing(page)).toBeVisible();
});

test('right-click anywhere during Edit Stops exits — station, segment, or background', async ({
  page,
}) => {
  await seedAndOpen(page, fourInLine);

  // On a station: exits without rotating or removing it.
  await openEditStops(page);
  const b = await stationCenter(page, 'B');
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(editing(page)).toBeHidden();
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem('vignelli-map-doc-v1');
      return raw ? ((JSON.parse(raw).state.stations.B.rotation ?? 0) as number) : -1;
    }),
  ).toBe(0);
  expect((await readLine(page)).stations).toEqual(['A', 'B', 'C', 'D']);

  // On a segment of the edited line: exits without cutting the edge. Assert
  // via the DOM — an exit makes no doc edit, so localStorage still holds the
  // pre-backfill seed (no `edges` field to read).
  await openEditStops(page);
  const p = await segPoint(page, 'B', 'C');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(editing(page)).toBeHidden();
  await expect(page.locator('[data-band-stripe]')).toHaveCount(3);

  // On the empty background: exits.
  await openEditStops(page);
  await page.mouse.click(b.x - 60, b.y - 140, { button: 'right' });
  await expect(editing(page)).toBeHidden();
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

async function segmentStyles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    return raw ? (JSON.parse(raw).state.lines.L1.segmentStyles ?? {}) : {};
  });
}

test('shift-click on an armed segment’s endpoint station cycles that segment', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await openEditStops(page);

  // Arm A–B, then shift-click the ENDPOINT station A (not the band): the band
  // of a short segment is occluded by its endpoints, so this is the path that
  // keeps it editable.
  const ab = await segPoint(page, 'A', 'B');
  await page.mouse.click(ab.x, ab.y);
  await expect(page.locator('[data-append-remove-segment="A|B"]')).toBeVisible();

  const a = await stationCenter(page, 'A');
  await clickAtWithModifiers(page, a, ['Shift']);

  await expect.poll(async () => await segmentStyles(page)).toEqual({ 'A|B': 'dashed' });
  // Shift over an endpoint did NOT connect/splice, and we stay in the editor.
  expect((await readLine(page)).stations).toEqual(['A', 'B', 'C', 'D']);
  await expect(editing(page)).toBeVisible();
});

test('alt-click reaches a short segment buried under its endpoint stations', async ({ page }) => {
  await seedAndOpen(page, shortSegment);
  // Enter Edit Stops via the long B–C stripe (A–B is too short to click).
  await page.locator('[data-band-stripe][data-line-id="L1"]').last().click({ force: true });
  await expect(editing(page)).toBeVisible();

  // The midpoint of A–B, whose band is fully under both stations' hit rects.
  const pa = await stopDotCenter(page, 'A');
  const pb = await stopDotCenter(page, 'B');
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };

  // A PLAIN click there lands on a station — never the buried A–B band...
  await page.mouse.click(mid.x, mid.y);
  const chip = page.locator('[data-append-remove-segment="A|B"]');
  await expect(chip).toHaveCount(0);
  // ...ALT-click cycles the stack (elementsFromPoint sees the stripe under the
  // station rects) — the two endpoint stations plus the buried A–B segment — so
  // within a couple of steps the segment arms.
  for (let i = 0; i < 4 && (await chip.count()) === 0; i++) {
    await clickAtWithModifiers(page, mid, ['Alt']);
  }
  await expect(chip).toBeVisible();
  await expect(editing(page)).toBeVisible();
});

test('a canvas label over the line does not steal the click while editing stops', async ({
  page,
}) => {
  await seedAndOpen(page, withLabelOverLine);
  await openEditStops(page);

  // Click dead on the label, which overlaps the B–C corridor. In Edit Stops the
  // label is click-through, so the click lands on the LINE. Arming B–C proves
  // the click reached the band; still being in the editor proves the label was
  // NOT clicked — its handler would have called setAppending(null) and dropped
  // us out. (A label selection can't be asserted via a popover here: the line
  // editor's own inspector popover is always pinned open in Edit Stops.)
  const g = await labelCenter(page, 'g1');
  await page.mouse.click(g.x, g.y);

  await expect(page.locator('[data-append-remove-segment="B|C"]')).toBeVisible();
  await expect(editing(page)).toBeVisible();
});
