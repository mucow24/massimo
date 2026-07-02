import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';
import { STOP_SIZE } from '../src/geometry/orientation';

// ACCEPTANCE SPEC for per-line width — written red-first (double-loop TDD)
// with `test.fail()` annotations that were removed once the feature landed.
//
// Widths: L1 stays at the default (14); L2 is 28. Two stripes are TANGENT
// when their centers sit (wA + wB) / 2 apart along the perpendicular — for
// 14/28 that's 21 world units = 1.5 rows.

const STRIPE = (page: Page, lineId: string) =>
  page.locator(`[data-band-stripe][data-line-id="${lineId}"]`).first();

// Two lines through the same station pair, stops spaced 1.5 rows apart —
// exactly tangent once L2 renders at width 28.
const mixedTangent: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: -120,
      y: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
        { lineId: 'L2', row: 1.5, col: 0, orientation: 'auto-horizontal' },
      ],
    },
    {
      id: 'B',
      name: 'B',
      x: 120,
      y: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
        { lineId: 'L2', row: 1.5, col: 0, orientation: 'auto-horizontal' },
      ],
    },
  ],
  lines: [
    { id: 'L1', service: '1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: '2', color: '#EE352E', stations: ['A', 'B'], width: 28 },
  ],
};

// One default-width line — the slider round-trip fixture.
const twoStop: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 120, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
};

// Legacy interlined pair: both default width, stops 1 row apart (tangent at
// 14/14). Widening L2 to 28 must SPLIT the band; re-spacing L2's stop to row
// 1.5 in the layout editor must RE-MERGE it as a mixed-width band.
const legacyInterlined: Seed = {
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
    { id: 'L1', service: '1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: '2', color: '#EE352E', stations: ['A', 'B'] },
  ],
};

async function selectLine(page: Page, lineId: string): Promise<void> {
  await STRIPE(page, lineId).click({ force: true });
  await page.locator('.inspector').waitFor();
}

// Set the line's width through the inspector spinbutton. A short visibility
// timeout keeps the pre-implementation red fast instead of a full default
// timeout while the control doesn't exist.
async function setWidthTo(page: Page, value: string): Promise<void> {
  const spin = page.getByRole('spinbutton', { name: 'Width' });
  await expect(spin).toBeVisible({ timeout: 2000 });
  await spin.fill(value);
  await spin.blur();
}

// Drag a layout-editor handle by (dRow, dCol) in the station-local frame,
// CTM-projected to page coords (mirrors matching.spec's drag helper).
async function dragStopByLocalDelta(
  page: Page,
  fromSel: string,
  dRow: number,
  dCol: number,
): Promise<void> {
  const from = page.locator(fromSel);
  const fromBox = await from.boundingBox();
  if (!fromBox) throw new Error(`drag source not visible: ${fromSel}`);
  const fx = fromBox.x + fromBox.width / 2;
  const fy = fromBox.y + fromBox.height / 2;

  const delta = await page.evaluate(
    ({ sel, dRow, dCol, PITCH }) => {
      // The handle <g> lives inside the station's translate+rotate group
      // on the MAIN canvas, so use the ELEMENT's CTM (the svg's alone
      // would miss the station rotation). One cell = STOP_SIZE world units.
      const g = document.querySelector(sel) as SVGGElement | null;
      const ctm = g?.getScreenCTM();
      if (!ctm) return null;
      return {
        x: dCol * PITCH * ctm.a + dRow * PITCH * ctm.c,
        y: dCol * PITCH * ctm.b + dRow * PITCH * ctm.d,
      };
    },
    { sel: fromSel, dRow, dCol, PITCH: STOP_SIZE },
  );
  if (!delta) throw new Error('no editor svg CTM');

  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 6, fy + 6);
  await page.mouse.move(fx + delta.x, fy + delta.y, { steps: 5 });
  await page.mouse.up();
}

/** Drive Canvas → Export → SVG and return the downloaded markup. */
async function exportSvg(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Canvas' }).click();
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

test.describe('Per-line width', () => {
  test('mixed-width tangent lines interline as ONE band with per-stripe widths', async ({
    page,
  }) => {
    await seedAndOpen(page, mixedTangent);

    const stripes = page.locator('[data-band-stripe]');
    await expect(stripes).toHaveCount(2);

    // One band: both stripes share the band key. (Today the 21-unit gap fails
    // the uniform-width merge gate, producing two single-stripe bands.)
    const keys = await stripes.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-band-key')),
    );
    expect(keys[0]).toBe(keys[1]);

    await expect(STRIPE(page, 'L1')).toHaveAttribute('stroke-width', '14');
    await expect(STRIPE(page, 'L2')).toHaveAttribute('stroke-width', '28');
  });

  test('a width edit updates the band live and persists across reload', async ({ page }) => {
    await seedAndOpen(page, twoStop);

    await selectLine(page, 'L1');
    await setWidthTo(page, '28');
    await expect(STRIPE(page, 'L1')).toHaveAttribute('stroke-width', '28');

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expect(STRIPE(page, 'L1')).toHaveAttribute('stroke-width', '28');
  });

  test('widening an interlined line splits the band; re-spacing its stop re-merges it', async ({
    page,
  }) => {
    await seedAndOpen(page, legacyInterlined);

    // Sanity: starts as one merged band.
    const bandKeys = async () =>
      page
        .locator('[data-band-stripe]')
        .evaluateAll((els) => new Set(els.map((el) => el.getAttribute('data-band-key'))).size);
    expect(await bandKeys()).toBe(1);

    // Widen L2 → stops are now 14 apart but tangency needs 21 → band splits.
    await selectLine(page, 'L2');
    await setWidthTo(page, '28');
    expect(await bandKeys()).toBe(2);

    // Re-space L2's stop at BOTH stations to row 1.5 (tangent again). The
    // ghost lattice scales to the pair tangency, so the drop lands exactly
    // on (1.5, 0).
    for (const sid of ['A', 'B'] as const) {
      const c = await stationCenter(page, sid);
      await page.mouse.click(c.x, c.y);
      await page.getByRole('button', { name: 'Edit layout' }).click();
      await dragStopByLocalDelta(
        page,
        '[data-cell-row="1"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L2"]',
        0.5,
        0,
      );
    }

    expect(await bandKeys()).toBe(1);
    await expect(STRIPE(page, 'L1')).toHaveAttribute('stroke-width', '14');
    await expect(STRIPE(page, 'L2')).toHaveAttribute('stroke-width', '28');
  });

  test('per-line width survives SVG export', async ({ page }) => {
    await seedAndOpen(page, mixedTangent);

    // Live canvas first (the export clones the live SVG, so this is the
    // meaningful assertion)…
    await expect(STRIPE(page, 'L2')).toHaveAttribute('stroke-width', '28');
    // …then the exported markup as an end-to-end smoke.
    const svg = await exportSvg(page);
    expect(svg).toContain('stroke-width="28"');
  });
});
