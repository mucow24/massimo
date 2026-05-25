import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

// World cx/cy of a stop's rendered dot (the StopGlyph element). The SVG
// viewBox is set so its content coords equal world coords; querying cx/cy
// reads the rendered position directly — which is what the compression pass
// produces.
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
      // Diamond shapes are <polygon> with no cx/cy; circles carry them
      // directly. The compressed-position tests always seed circle-shaped
      // dots (the default), so this branch is enough.
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

// Three lines (L1, L2, L3) interlined on a diagonal NW-SE axis. At each end
// station, the three stops sit at perp-adjacent cells along the band's perp
// (NE-SW) axis: (row=1,col=2), (row=2,col=1), (row=3,col=0). At rotation 0
// these world positions sit on a line oriented NE→SW, perp-distance
// STOP_SIZE·√2 apart, parallel-position identical.
//
// Both stations are spaced along the NW-SE travel axis far enough apart that
// the band rounds cleanly through the fillets.
const STOP_SIZE = 14;

const diagonalBandSeed: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 1, col: 2, orientation: 'auto-nw-se' },
        { lineId: 'L2', row: 2, col: 1, orientation: 'auto-nw-se' },
        { lineId: 'L3', row: 3, col: 0, orientation: 'auto-nw-se' },
      ],
    },
    {
      id: 'B',
      name: 'B',
      x: 200,
      y: 200,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 1, col: 2, orientation: 'auto-nw-se' },
        { lineId: 'L2', row: 2, col: 1, orientation: 'auto-nw-se' },
        { lineId: 'L3', row: 3, col: 0, orientation: 'auto-nw-se' },
      ],
    },
  ],
  lines: [
    { id: 'L1', service: 'L1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: 'L2', color: '#EE352E', stations: ['A', 'B'] },
    { id: 'L3', service: 'L3', color: '#00933C', stations: ['A', 'B'] },
  ],
};

// Same as above plus a 4th line L4 on a different axis (auto-horizontal)
// sitting at cell (row=4, col=-1) on station A — one king-diagonal step SW
// of L3, so it's a trailer past the SW end of the band.
const diagonalBandWithTrailerSeed: Seed = {
  ...diagonalBandSeed,
  stations: diagonalBandSeed.stations.map((s) =>
    s.id === 'A'
      ? {
          ...s,
          stops: [
            ...s.stops,
            { lineId: 'L4', row: 4, col: -1, orientation: 'auto-horizontal' },
          ],
        }
      : s,
  ),
  lines: [
    ...diagonalBandSeed.lines,
    // L4 goes from A to a far-east station C so the band has somewhere to go.
    { id: 'L4', service: 'L4', color: '#808080', stations: ['A', 'C'] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Diagonal interlining — compressed dot positions', () => {
  test('three auto-nw-se stops pack at STOP_SIZE perp spacing on the band centerline', async ({
    page,
  }) => {
    await seedAndOpen(page, diagonalBandSeed);

    const a1 = await dotWorldPos(page, 'A', 'L1');
    const a2 = await dotWorldPos(page, 'A', 'L2');
    const a3 = await dotWorldPos(page, 'A', 'L3');

    // Centroid of compressed positions = centroid of cell-grid positions.
    // Cell-grid centroid: ((28+14+0)/3, (14+28+42)/3) = (14, 28) — exactly L2's cell.
    expect((a1.x + a2.x + a3.x) / 3).toBeCloseTo(14, 1);
    expect((a1.y + a2.y + a3.y) / 3).toBeCloseTo(28, 1);

    // The middle stop (L2) sits at the centroid — no shift.
    expect(a2.x).toBeCloseTo(14, 1);
    expect(a2.y).toBeCloseTo(28, 1);

    // Each consecutive pair sits STOP_SIZE apart in world (post-compression).
    const d12 = Math.hypot(a2.x - a1.x, a2.y - a1.y);
    const d23 = Math.hypot(a3.x - a2.x, a3.y - a2.y);
    expect(d12).toBeCloseTo(STOP_SIZE, 1);
    expect(d23).toBeCloseTo(STOP_SIZE, 1);

    // L1↔L3 displacement is twice STOP_SIZE along the band's perp axis.
    // Without compression it would be STOP_SIZE·√2 ≈ 19.8 apart — confirming
    // we're seeing the compressed geometry, not the cell-grid geometry.
    expect(Math.hypot(a3.x - a1.x, a3.y - a1.y)).toBeCloseTo(2 * STOP_SIZE, 1);
  });

  test('compressed dots match between the two band endpoints (same relative geometry)', async ({
    page,
  }) => {
    await seedAndOpen(page, diagonalBandSeed);

    const a1 = await dotWorldPos(page, 'A', 'L1');
    const a3 = await dotWorldPos(page, 'A', 'L3');
    const b1 = await dotWorldPos(page, 'B', 'L1');
    const b3 = await dotWorldPos(page, 'B', 'L3');

    // The band travels from A to B along (+200, +200). Each side's local
    // compressed offsets should mirror, so b - a is the same vector at both
    // ends.
    expect(b1.x - a1.x).toBeCloseTo(200, 1);
    expect(b1.y - a1.y).toBeCloseTo(200, 1);
    expect(b3.x - a3.x).toBeCloseTo(200, 1);
    expect(b3.y - a3.y).toBeCloseTo(200, 1);
  });
});

test.describe('Diagonal interlining — trailer pull', () => {
  test('a king-adjacent trailer on a different axis sits STOP_SIZE from its anchor', async ({
    page,
  }) => {
    await seedAndOpen(page, {
      ...diagonalBandWithTrailerSeed,
      stations: [
        ...diagonalBandWithTrailerSeed.stations,
        // L4 needs a second endpoint; place it well out of the way.
        { id: 'C', name: 'C', x: 1000, y: 1000, stops: [{ lineId: 'L4', row: 0, col: 0 }] },
      ],
    });

    const a3 = await dotWorldPos(page, 'A', 'L3');
    const a4 = await dotWorldPos(page, 'A', 'L4');

    // Trailer should sit exactly STOP_SIZE from L3 (the anchor), along the
    // king-direction that the trailer lies from L3 in the cell grid.
    // L3 cell (row=3, col=0) → world (0, 42). L4 cell (row=4, col=-1) →
    // world (-14, 56). king-direction = SW = (-√2/2, √2/2). Trailer should
    // land at L3_rendered + STOP_SIZE·SW.
    const dist = Math.hypot(a4.x - a3.x, a4.y - a3.y);
    expect(dist).toBeCloseTo(STOP_SIZE, 1);
    // Direction: SW means dx negative, dy positive, equal magnitudes.
    expect(a4.x - a3.x).toBeCloseTo(-STOP_SIZE * Math.SQRT1_2, 1);
    expect(a4.y - a3.y).toBeCloseTo(STOP_SIZE * Math.SQRT1_2, 1);
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

    // Select the station so the StopGrid renders.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    const cell = page.locator(
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
    );
    // The cell <g> contains both the glyph <text> and a <title> sibling, so
    // textContent at the <g> level is "<glyph><title-text>". Scope assertions
    // to the <text> child to read just the glyph.
    const glyph = cell.locator('text');
    await expect(glyph).toHaveText('↕'); // auto-vertical glyph

    // Right-click 1: → auto-ne-sw (⤢)
    await cell.click({ button: 'right' });
    await expect(glyph).toHaveText('⤢');

    // Right-click 2: → auto-horizontal (↔)
    await cell.click({ button: 'right' });
    await expect(glyph).toHaveText('↔');

    // Right-click 3: → auto-nw-se (⤡)
    await cell.click({ button: 'right' });
    await expect(glyph).toHaveText('⤡');

    // Right-click 4: → back to auto-vertical (↕)
    await cell.click({ button: 'right' });
    await expect(glyph).toHaveText('↕');
  });
});
