import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

async function stationWorldPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  return await page.evaluate((sid) => {
    const el = document.querySelector(`[data-station-id="${sid}"]`);
    if (!el) throw new Error(`station ${sid} not in DOM`);
    const t = el.getAttribute('transform') ?? '';
    const m = t.match(/translate\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
    if (!m) throw new Error(`could not parse transform "${t}"`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }, id);
}

// Vertical line A(0,-100) — B(0,0) — C(0,100) with default auto-vertical
// stops. Snap axis at every station is +y. The midpoint (equidistant target)
// for B is exactly y=0; the previous-neighbor (tens) anchor is A at y=-100.
const verticalLine: Seed = {
  stations: [
    { id: 'A', name: 'A', x: 0, y: -100, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'C', name: 'C', x: 0, y: 100, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C'] }],
};

test.beforeEach(async ({ page }) => {
  // Reset persisted snap prefs to defaults so each test starts deterministic
  // — snap-prefs persistence is the whole point of the feature, but it would
  // make the test order-dependent.
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('massimo-snap-prefs-v1'));
});

test.describe('Snap mode toolbar', () => {
  test('renders the snap toggles, with Line active by default', async ({ page }) => {
    await seedAndOpen(page, verticalLine);
    await expect(page.getByRole('button', { name: 'Snap to line', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Snap to equidistant' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Snap to grid length' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Snap to all' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('Equidistant is disabled when Line is off; Grid length and All stay enabled', async ({
    page,
  }) => {
    await seedAndOpen(page, verticalLine);
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Snap to equidistant' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Grid length applies to any snapped object now, so it no longer gates on Line.
    await expect(page.getByRole('button', { name: 'Snap to grid length' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    // All is independent.
    await expect(page.getByRole('button', { name: 'Snap to all' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
});

test.describe('Snap modes wired through to the engine', () => {
  test('Equidistant: middle station snaps to the midpoint between same-line neighbors', async ({
    page,
  }) => {
    await seedAndOpen(page, verticalLine);

    // Toggle equidistant on. Line is on by default.
    await page.getByRole('button', { name: 'Snap to equidistant' }).click();

    const b = await stationCenter(page, 'B');
    // Drag B 5 px right + 3 px down (5 px exceeds the 4-px drag threshold).
    // World coords at zoom=1 match page deltas. Line snap pulls x back to 0;
    // equidistant pulls y back to 0 (the midpoint of -100 and 100).
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 3, { steps: 3 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.x).toBeCloseTo(0, 1);
    expect(pos.y).toBeCloseTo(0, 1);
  });

  test('Equidistant: end terminus extrapolates the prev-prev → prev cadence', async ({
    page,
  }) => {
    await seedAndOpen(page, verticalLine);

    // Toggle equidistant on. Line is on by default.
    await page.getByRole('button', { name: 'Snap to equidistant' }).click();

    // Vertical line A(0,-100), B(0,0), C(0,100). C is the end terminus —
    // the prev-prev → prev (A → B) cadence is 100, so the snap target for
    // C is B + 100 = (0, 100), which is where C already sits. Drag C
    // slightly off cadence (+5 x, +7 y); within the 10-unit tolerance the
    // new branch should pull y back to 100 (line snap alone would only fix
    // x, leaving y at ~107).
    const c = await stationCenter(page, 'C');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 5, c.y + 7, { steps: 3 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'C');
    expect(pos.x).toBeCloseTo(0, 1);
    expect(pos.y).toBeCloseTo(100, 1);
  });

  test('Equidistant off: middle station only snaps to the line, not the midpoint', async ({
    page,
  }) => {
    await seedAndOpen(page, verticalLine);

    // Default: line on, equidistant off.
    const b = await stationCenter(page, 'B');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 3, { steps: 3 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    // x snaps onto the vertical line at 0; y is the projected y (≈3),
    // NOT the midpoint at 0.
    expect(pos.x).toBeCloseTo(0, 1);
    expect(Math.abs(pos.y)).toBeGreaterThan(1);
  });

  test('Snap-to-all: aligns to a stop independent of line membership', async ({ page }) => {
    // Use a fixture where B has no line connection to a far station, then
    // drag B near that station's column with `all` mode on. With Line off,
    // there's no other snap available — only `all` can engage.
    const seed: Seed = {
      stations: [
        // Anchor station off in the corner; B has no line connection to it.
        { id: 'X', name: 'X', x: 200, y: -300, stops: [{ lineId: 'LX', row: 0, col: 0 }] },
        { id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'LB', row: 0, col: 0 }] },
      ],
      lines: [
        { id: 'LX', service: 'X', color: '#0039A6', stations: ['X'] },
        { id: 'LB', service: 'B', color: '#A00033', stations: ['B'] },
      ],
    };
    await seedAndOpen(page, seed);

    // Turn line off; cycle "Snap to all" to its final "All directions" state
    // (off → horizontal → vertical → diagonal → all = 4 clicks).
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    const allBtn = page.getByRole('button', { name: 'Snap to all' });
    for (let i = 0; i < 4; i++) await allBtn.click();
    await expect(allBtn).toHaveAttribute('data-snap-state', 'all');

    const b = await stationCenter(page, 'B');
    // Drag B toward x ≈ 200 (close enough to engage the snap-to-all
    // vertical alignment with X). Adding 200 to start moves the page
    // pointer ~200 px right, which is 200 world units at zoom=1.
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 50, b.y, { steps: 3 });
    await page.mouse.move(b.x + 198, b.y, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    // Expect x=200 exactly (vertical alignment with X), y≈0.
    expect(pos.x).toBeCloseTo(200, 0);
    expect(Math.abs(pos.y)).toBeLessThan(2);
  });

  // X sits at (200, -300): vertically aligned with B's column (x=200) but NOT
  // horizontally aligned (different y). So "Vertical only" should snap B's x
  // to 200, while "Horizontal only" should leave it alone.
  const verticalOnlySeed: Seed = {
    stations: [
      { id: 'X', name: 'X', x: 200, y: -300, stops: [{ lineId: 'LX', row: 0, col: 0 }] },
      { id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'LB', row: 0, col: 0 }] },
    ],
    lines: [
      { id: 'LX', service: 'X', color: '#0039A6', stations: ['X'] },
      { id: 'LB', service: 'B', color: '#A00033', stations: ['B'] },
    ],
  };

  test('Snap-to-all Horizontal-only ignores a vertical alignment', async ({ page }) => {
    await seedAndOpen(page, verticalOnlySeed);
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    // One click: off → horizontal.
    const allBtn = page.getByRole('button', { name: 'Snap to all' });
    await allBtn.click();
    await expect(allBtn).toHaveAttribute('data-snap-state', 'horizontal');

    const b = await stationCenter(page, 'B');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 198, b.y, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    // Vertical alignment with X is ignored in horizontal-only mode — x is NOT
    // pulled to 200.
    expect(pos.x).toBeCloseTo(198, 0);
  });

  test('Snap-to-all Vertical-only snaps a vertical alignment', async ({ page }) => {
    await seedAndOpen(page, verticalOnlySeed);
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    // Two clicks: off → horizontal → vertical.
    const allBtn = page.getByRole('button', { name: 'Snap to all' });
    await allBtn.click();
    await allBtn.click();
    await expect(allBtn).toHaveAttribute('data-snap-state', 'vertical');

    const b = await stationCenter(page, 'B');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 198, b.y, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.x).toBeCloseTo(200, 0);
  });

  test('Snap-to-grid Horizontal-only snaps Y to the grid, leaves X free', async ({ page }) => {
    // A lone station with no neighbors — nothing aligns, so the grid fallback
    // is the only thing that can move it.
    const loneSeed: Seed = {
      stations: [{ id: 'B', name: 'B', x: 0, y: 0, stops: [{ lineId: 'LB', row: 0, col: 0 }] }],
      lines: [{ id: 'LB', service: 'B', color: '#A00033', stations: ['B'] }],
    };
    await seedAndOpen(page, loneSeed);
    await page.getByRole('button', { name: 'Snap to line', exact: true }).click();
    // One click: off → horizontal (locks Y).
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click();
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'horizontal');

    const b = await stationCenter(page, 'B');
    // Drag +23 x, +27 y. Horizontal grid locks Y → 30; X stays ~23.
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 23, b.y + 27, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.y).toBeCloseTo(30, 0);
    expect(pos.x).toBeCloseTo(23, 0);
  });

  test('Line + grid compose: line locks the perpendicular while grid steps along the axis', async ({
    page,
  }) => {
    // Vertical line A(0,-100), B(0,0), C(0,100) — axis at B is +y. Line is on
    // by default; turn grid to 'horizontal' (locks Y). Dragging B should stay
    // glued to the line (x→0) while the free along-axis coordinate (y) snaps
    // to the grid — proving the two modes work together, not one-or-the-other.
    await seedAndOpen(page, verticalLine);
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click(); // off → horizontal (locks Y)
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'horizontal');

    const b = await stationCenter(page, 'B');
    // Drag +5 x, +23 y. Line snap pulls x back to 0 (perpendicular lock);
    // horizontal grid snaps the along-axis y from 23 → 20.
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 23, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.x).toBeCloseTo(0, 0);
    expect(pos.y).toBeCloseTo(20, 0);
  });

  test("Grid 'both' drops a line lock to an off-grid neighbor → lands on grid", async ({
    page,
  }) => {
    // Horizontal line A(0,5) — B(40,5) sits at y=5 (off the grid). With grid
    // 'both', dragging B toward A cannot reconcile the line lock with the grid
    // (it would sit at y=5), so the line yields entirely and B snaps purely to
    // the grid — NOT to the off-grid line.
    const offGridLine: Seed = {
      stations: [
        {
          id: 'A',
          name: 'A',
          x: 0,
          y: 5,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
        },
        {
          id: 'B',
          name: 'B',
          x: 40,
          y: 5,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
        },
      ],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
    };
    await seedAndOpen(page, offGridLine);
    const gridBtn = page.getByRole('button', { name: 'Snap to grid', exact: true });
    await gridBtn.click(); // off → horizontal
    await gridBtn.click(); // horizontal → vertical
    await gridBtn.click(); // vertical → both
    await expect(gridBtn).toHaveAttribute('data-snap-state', 'both');

    const b = await stationCenter(page, 'B');
    // Drag B by -13 x, +1 y → world ≈ (27, 6). Off-grid line lock would hold
    // y=5; grid 'both' snaps to the nearest grid point (30, 10) instead.
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x - 13, b.y + 1, { steps: 5 });
    await page.mouse.up();

    const pos = await stationWorldPos(page, 'B');
    expect(pos.x).toBeCloseTo(30, 0);
    expect(pos.y).toBeCloseTo(10, 0);
  });
});
