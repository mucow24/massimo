import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openLineStyleDetail, openMapMenu, seedAndOpen, type Seed } from './fixtures';

// ACCEPTANCE SPEC for per-line stroke (casing) — written red-first
// (double-loop TDD) with `test.fail()` annotations that were removed once
// the feature landed. (The "default renders no casing" case passed from day
// one, so it never carried an annotation.)
//
// A stroke of width s paints the band casing as a SILHOUETTE — the stripe path
// stroked (bodyWidth + s) wide in the line's strokeColor, painted just BEHIND an
// INSET body (bodyWidth − s) at priority + ε — so a line's own overlapping bands
// (loops/branches) merge into one continuous outer casing instead of splitting
// the color (see model/lineStroke.ts). Between DIFFERENT interlined lines the
// inset bodies leave a railW gap the silhouettes fill, so the separator is
// preserved. Each stop MARKER still carries matching centered rails on its
// travel-axis edges (StopMarker is unchanged).

const STRIPE = (page: Page, lineId: string) =>
  page.locator(`[data-band-stripe][data-line-id="${lineId}"]`).first();
const CASING = (page: Page, lineId: string) =>
  page.locator(`[data-band-casing][data-line-id="${lineId}"]`).first();

// One default-width line with a seeded red casing: two 4-wide edge rails.
const strokedTwoStop: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: -120,
      y: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    },
    {
      id: 'B',
      name: 'B',
      x: 120,
      y: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    },
  ],
  lines: [
    {
      id: 'L1',
      service: 'L',
      color: '#0039A6',
      stations: ['A', 'B'],
      strokeWidth: 4,
      strokeColor: '#ff0000',
    },
  ],
};

// Same shape, no stroke fields — the bare default + the live-edit fixture.
const bareTwoStop: Seed = {
  stations: strokedTwoStop.stations,
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
};

// Three colinear stations on one stroked line: two bands + three markers,
// each body followed immediately by its own inside rails.
const strokedThreeStop: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: -200,
      y: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    },
    {
      id: 'B',
      name: 'B',
      x: 0,
      y: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    },
    {
      id: 'C',
      name: 'C',
      x: 200,
      y: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    },
  ],
  lines: [
    {
      id: 'L1',
      service: 'L',
      color: '#0039A6',
      stations: ['A', 'B', 'C'],
      strokeWidth: 4,
      strokeColor: '#ff0000',
    },
  ],
};

// Interlined tangent pair (default widths, 1 row apart). L1 is FRONT
// (lineOrder index 0) and stroked; L2 is the bare back line. L1's rails
// ride inside its own footprint, painted right after its body.
const tangentFrontStroked: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: -120,
      y: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
        { lineId: 'L2', row: 1, col: 0, orientation: 'auto-horizontal' },
      ],
    },
    {
      id: 'B',
      name: 'B',
      x: 120,
      y: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
        { lineId: 'L2', row: 1, col: 0, orientation: 'auto-horizontal' },
      ],
    },
  ],
  lines: [
    {
      id: 'L1',
      service: '1',
      color: '#0039A6',
      stations: ['A', 'B'],
      strokeWidth: 3,
      strokeColor: '#ffffff',
    },
    { id: 'L2', service: '2', color: '#EE352E', stations: ['A', 'B'] },
  ],
};

async function selectLine(page: Page, lineId: string): Promise<void> {
  await STRIPE(page, lineId).click({ force: true });
  await page.locator('.inspector').waitFor();
  // The width/stroke controls live inside the collapsed style detail.
  await openLineStyleDetail(page);
}

// Set the line's stroke width through the inspector spinbutton. Short
// visibility timeout keeps the pre-implementation red fast.
async function setStrokeTo(page: Page, value: string): Promise<void> {
  const spin = page.getByRole('spinbutton', { name: 'Stroke width' });
  await expect(spin).toBeVisible({ timeout: 2000 });
  await spin.fill(value);
  await spin.blur();
}

// Set the stroke color through the ColorField picker: open the swatch, set the
// value in the picker's hex field (one input event, like a paste), close it.
async function setStrokeColorTo(page: Page, value: string): Promise<void> {
  // The casing color is a day/night PAIR: exact match so this picks the light
  // swatch, not "Dark mode stroke color" beside it.
  await page.getByRole('button', { name: 'Stroke color', exact: true }).click();
  const hex = page.getByLabel('Stroke color hex value');
  await expect(hex).toBeVisible({ timeout: 2000 });
  await hex.fill(value);
  await page.keyboard.press('Escape');
}

// Document-order kinds of L1's casing-rail + body-stripe elements. Body
// markers carry no data attributes; the marker-rails-after-marker-body
// ordering is pinned by the StopMarker unit tests instead.
async function casingThenBodyOrder(page: Page, lineId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const els = document.querySelectorAll(
      `.canvas-host svg [data-band-casing][data-line-id="${id}"],` +
        `.canvas-host svg [data-marker-casing][data-line-id="${id}"],` +
        `.canvas-host svg [data-band-stripe][data-line-id="${id}"]`,
    );
    return [...els].map((el) =>
      el.hasAttribute('data-band-casing')
        ? 'casing'
        : el.hasAttribute('data-marker-casing')
          ? 'marker-casing'
          : 'stripe',
    );
  }, lineId);
}

/** Drive Map → Export → SVG and return the downloaded markup. */
async function exportSvg(page: Page): Promise<string> {
  await openMapMenu(page);
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'SVG', exact: true }).click();
  const download: Download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('download has no path');
  return readFileSync(path).toString('utf-8');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Per-line stroke', () => {
  test('a line without stroke renders no casing', async ({ page }) => {
    await seedAndOpen(page, bareTwoStop);

    await expect(page.locator('[data-band-stripe]')).toHaveCount(1);
    await expect(page.locator('[data-band-casing]')).toHaveCount(0);
    await expect(page.locator('[data-marker-casing]')).toHaveCount(0);
  });

  test('a seeded stroke renders a casing silhouette on the stripe and marker rails', async ({
    page,
  }) => {
    await seedAndOpen(page, strokedTwoStop);

    // ONE casing silhouette (body + railW wide) in the stroke color, painted
    // just behind the body — the band merges its own overlaps into one outer
    // casing instead of two centered rails (see lineStroke.ts).
    const casing = page.locator('[data-band-casing][data-line-id="L1"]');
    await expect(casing).toHaveCount(1);
    await expect(casing).toHaveAttribute('stroke-width', '18'); // width 14 + railW 4
    await expect(casing).toHaveAttribute('stroke', '#ff0000');

    // Each stop marker gets two rails on its travel-axis edges, continuing
    // the stripe rails through the station — and both stops here are
    // TERMINI, so each also gets an end-cap rail across the line's end.
    const markerRails = page.locator('rect[data-marker-casing][data-line-id="L1"]');
    await expect(markerRails).toHaveCount(4); // 2 stops × 2 side rails
    for (const rail of await markerRails.all()) {
      await expect(rail).toHaveAttribute('width', '14'); // along travel
      await expect(rail).toHaveAttribute('height', '4'); // rail thick
      await expect(rail).toHaveAttribute('fill', '#ff0000');
    }
    const endCaps = page.locator('line[data-marker-casing][data-line-id="L1"]');
    await expect(endCaps).toHaveCount(2); // one per terminus
    for (const cap of await endCaps.all()) {
      await expect(cap).toHaveAttribute('stroke-width', '4');
      await expect(cap).toHaveAttribute('stroke', '#ff0000');
    }

    // The body is inset by railW so the silhouette shows a railW rim on each edge.
    await expect(STRIPE(page, 'L1')).toHaveAttribute('stroke-width', '10'); // 14 − railW 4
    // The silhouette (casing) paints just before its own body; marker rails ride
    // their markers at the end.
    expect(await casingThenBodyOrder(page, 'L1')).toEqual([
      'casing',
      'stripe',
      'marker-casing',
      'marker-casing',
      'marker-casing',
      'marker-casing',
      'marker-casing',
      'marker-casing',
    ]);
  });

  test('a stroke edit updates live and persists across reload', async ({ page }) => {
    await seedAndOpen(page, bareTwoStop);

    await selectLine(page, 'L1');
    await setStrokeTo(page, '4');
    // The casing silhouette is body (14) + railW (4) wide.
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke-width', '18');
    // Default color is white.
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke', '#ffffff');

    await setStrokeColorTo(page, '#00aa00');
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke', '#00aa00');

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke-width', '18');
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke', '#00aa00');

    // Back to 0: the casing disappears and the field drops out of the
    // persisted doc (the default is never stored).
    await selectLine(page, 'L1');
    await setStrokeTo(page, '0');
    await expect(page.locator('[data-band-casing]')).toHaveCount(0);
    await expect(page.locator('[data-marker-casing]')).toHaveCount(0);
    const storedLine = await page.evaluate(
      () => JSON.parse(localStorage.getItem('vignelli-map-doc-v1')!).state.lines.L1,
    );
    expect(storedLine.strokeWidth).toBeUndefined();
  });

  test('the spinbutton accepts values above the slider max; render clamps at the width', async ({
    page,
  }) => {
    await seedAndOpen(page, bareTwoStop);

    await selectLine(page, 'L1');
    await setStrokeTo(page, '30');
    // Stored uncapped…
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('vignelli-map-doc-v1')!).state.lines.L1.strokeWidth,
    );
    expect(stored).toBe(30);
    // …the rendered railW clamps at the stripe width (14), so the silhouette is
    // width + clamped railW = 14 + 14 = 28.
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke-width', '28');

    // Half-step values render as-is: silhouette = 14 + 1.5 = 15.5.
    await setStrokeTo(page, '1.5');
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke-width', '15.5');
  });

  test('casing silhouettes paint behind their own bodies through multi-segment lines', async ({
    page,
  }) => {
    await seedAndOpen(page, strokedThreeStop);

    const order = await casingThenBodyOrder(page, 'L1');
    // Both bands' silhouettes paint (priority + ε), then both bodies, then the
    // marker rails ride their markers at the end (the two TERMINI add an end
    // cap each, the interior stop doesn't). Same-line silhouettes-before-bodies
    // is what merges a line's own overlaps.
    expect(order).toEqual([
      'casing', // band A|B silhouette
      'casing', // band B|C silhouette
      'stripe', // band A|B body
      'stripe', // band B|C body
      // terminus A: 2 side rails + end cap
      'marker-casing',
      'marker-casing',
      'marker-casing',
      // interior B: 2 side rails
      'marker-casing',
      'marker-casing',
      // terminus C: 2 side rails + end cap
      'marker-casing',
      'marker-casing',
      'marker-casing',
    ]);
  });

  test('a front line’s casing silhouette paints just behind its own body', async ({ page }) => {
    await seedAndOpen(page, tangentFrontStroked);

    const order = await page.evaluate(() => {
      const els = document.querySelectorAll(
        '.canvas-host svg [data-band-stripe], .canvas-host svg [data-band-casing]',
      );
      return [...els].map(
        (el) =>
          (el.hasAttribute('data-band-casing') ? 'casing:' : 'stripe:') +
          el.getAttribute('data-line-id'),
      );
    });
    // L2 (back, no casing) body; then L1's casing silhouette (priority + ε) just
    // behind its own body. L2 has no casing, so no L2 silhouette.
    expect(order).toEqual(['stripe:L2', 'casing:L1', 'stripe:L1']);
  });

  test('the casing survives SVG export', async ({ page }) => {
    await seedAndOpen(page, strokedTwoStop);

    // Live canvas first (the export clones the live SVG)…
    await expect(CASING(page, 'L1')).toHaveAttribute('stroke-width', '18'); // silhouette 14 + 4
    // …then the exported markup as an end-to-end smoke.
    const svg = await exportSvg(page);
    expect(svg).toContain('data-band-casing');
  });
});
