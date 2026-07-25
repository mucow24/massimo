import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

// World cx/cy of a stop's rendered dot (the StopGlyph element). The SVG
// viewBox is set so its content coords equal world coords; querying cx/cy
// reads the rendered position directly — which equals the cell-grid
// position now that the compression heuristic is gone.
async function dotWorldPos(
  page: Page,
  stationId: string,
  lineId: string,
): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ({ sid, lid }) => {
      const el = document.querySelector(
        `[data-stop-station="${sid}"][data-stop-line="${lid}"]`,
      ) as SVGCircleElement | SVGPolygonElement | null;
      if (!el) throw new Error(`dot missing for ${sid}/${lid}`);
      const cx = el.getAttribute('cx');
      const cy = el.getAttribute('cy');
      if (cx === null || cy === null) {
        throw new Error(`dot for ${sid}/${lid} has no cx/cy (shape: ${el.tagName})`);
      }
      return { x: parseFloat(cx), y: parseFloat(cy) };
    },
    { sid: stationId, lid: lineId },
  );
}

const STOP_SIZE = 14;
const H = Math.SQRT1_2; // √2/2 — one step on the diagonal basis.

// Three lines (L1, L2, L3) interlined on a diagonal NW-SE axis. Stops sit
// at diagonal-basis fractional cells: (0,0), (-H, H), (-2H, 2H). Perp axis
// NE-SW; consecutive cells are STOP_SIZE perp apart in world (the band
// stripe pitch), parallel-position identical.
const diagonalBandSeed: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-nw-se' },
        { lineId: 'L2', row: -H, col: H, orientation: 'auto-nw-se' },
        { lineId: 'L3', row: -2 * H, col: 2 * H, orientation: 'auto-nw-se' },
      ],
    },
    {
      id: 'B',
      name: 'B',
      x: 200,
      y: 200,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-nw-se' },
        { lineId: 'L2', row: -H, col: H, orientation: 'auto-nw-se' },
        { lineId: 'L3', row: -2 * H, col: 2 * H, orientation: 'auto-nw-se' },
      ],
    },
  ],
  lines: [
    { id: 'L1', service: 'L1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: 'L2', color: '#EE352E', stations: ['A', 'B'] },
    { id: 'L3', service: 'L3', color: '#00933C', stations: ['A', 'B'] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Diagonal interlining — cell-grid is the rendered position', () => {
  test('three auto-nw-se stops on the diagonal basis pack at STOP_SIZE perp spacing', async ({
    page,
  }) => {
    await seedAndOpen(page, diagonalBandSeed);

    const a1 = await dotWorldPos(page, 'A', 'L1');
    const a2 = await dotWorldPos(page, 'A', 'L2');
    const a3 = await dotWorldPos(page, 'A', 'L3');

    // Each dot sits at its literal cell-grid world position (station anchor
    // (0,0) + cell offset · STOP_SIZE at rotation 0). No neighbor-aware
    // shift is applied.
    expect(a1.x).toBeCloseTo(0, 1);
    expect(a1.y).toBeCloseTo(0, 1);
    expect(a2.x).toBeCloseTo(H * STOP_SIZE, 1);
    expect(a2.y).toBeCloseTo(-H * STOP_SIZE, 1);
    expect(a3.x).toBeCloseTo(2 * H * STOP_SIZE, 1);
    expect(a3.y).toBeCloseTo(-2 * H * STOP_SIZE, 1);

    // Consecutive pairs at STOP_SIZE apart in world — the band stripe pitch.
    expect(Math.hypot(a2.x - a1.x, a2.y - a1.y)).toBeCloseTo(STOP_SIZE, 1);
    expect(Math.hypot(a3.x - a2.x, a3.y - a2.y)).toBeCloseTo(STOP_SIZE, 1);
  });

  test('dots match between the two band endpoints (same relative geometry)', async ({ page }) => {
    await seedAndOpen(page, diagonalBandSeed);

    const a1 = await dotWorldPos(page, 'A', 'L1');
    const a3 = await dotWorldPos(page, 'A', 'L3');
    const b1 = await dotWorldPos(page, 'B', 'L1');
    const b3 = await dotWorldPos(page, 'B', 'L3');

    // The band travels from A to B along (+200, +200). Each side's local
    // offsets are identical, so b - a is the same vector at both ends.
    expect(b1.x - a1.x).toBeCloseTo(200, 1);
    expect(b1.y - a1.y).toBeCloseTo(200, 1);
    expect(b3.x - a3.x).toBeCloseTo(200, 1);
    expect(b3.y - a3.y).toBeCloseTo(200, 1);
  });
});

test.describe('Diagonal interlining — right-click cycle in inspector', () => {
  test('right-clicking a stop cell cycles orientation N/S → NE/SW → E/W → NW/SE → N/S', async ({
    page,
  }) => {
    // Single station with one stop; default orientation is auto-vertical.
    await seedAndOpen(page, {
      stations: [
        {
          id: 'A',
          name: 'A',
          x: 0,
          y: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0 }], // defaults to auto-vertical
        },
      ],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A'] }],
    });

    // Select the station and open the on-canvas layout editor.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Edit layout' }).click();

    const cell = page.locator(
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
    );
    // The orientation is drawn as an arrow rotated onto its axis, tagged with
    // that axis by name — the rotation alone would be unreadable here.
    const arrow = cell.locator('[data-arrow-axis]');
    await expect(arrow).toHaveAttribute('data-arrow-axis', 'auto-vertical');

    // Right-click 1: → auto-ne-sw
    await cell.click({ button: 'right' });
    await expect(arrow).toHaveAttribute('data-arrow-axis', 'auto-ne-sw');

    // Right-click 2: → auto-horizontal
    await cell.click({ button: 'right' });
    await expect(arrow).toHaveAttribute('data-arrow-axis', 'auto-horizontal');

    // Right-click 3: → auto-nw-se
    await cell.click({ button: 'right' });
    await expect(arrow).toHaveAttribute('data-arrow-axis', 'auto-nw-se');

    // Right-click 4: → back to auto-vertical
    await cell.click({ button: 'right' });
    await expect(arrow).toHaveAttribute('data-arrow-axis', 'auto-vertical');
  });
});
