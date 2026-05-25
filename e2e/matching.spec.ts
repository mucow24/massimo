import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';
import { PITCH } from '../src/components/inspector/stopGridDrag';

// Three stations on one line. A and B are identical (rotation 0, label cell
// at (-1, -1) reading rotation 0). C is the 180° layout-mirror of A: station
// rotation 4, label cell flipped to (1, 1), label rotation 4. C renders
// identically to A and B in the world but is structurally different in the
// model — exactly the case `findMatchingStations` was missing.
const mirroredTrio: Seed = {
  stations: [
    {
      id: 'A',
      name: 'A',
      x: -200,
      y: 0,
      rotation: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
      label: { row: -1, col: -1, rotation: 0, offset: 0 },
    },
    {
      id: 'B',
      name: 'B',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
      label: { row: -1, col: -1, rotation: 0, offset: 0 },
    },
    {
      id: 'C',
      name: 'C',
      x: 200,
      y: 0,
      rotation: 4,
      stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
      label: { row: 1, col: 1, rotation: 4, offset: 0 },
    },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C'] }],
};

// World position of a stop relative to its station's origin, in page pixels.
// Two stations that look visually identical must produce the same offset.
async function stopWorldOffset(
  page: Page,
  stationId: string,
  lineId: string,
): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ({ sid, lid }) => {
      const stationEl = document.querySelector(`[data-station-id="${sid}"]`);
      const stopEl = document.querySelector(
        `[data-stop-station="${sid}"][data-stop-line="${lid}"]`,
      );
      if (!stationEl || !stopEl) throw new Error(`missing element for ${sid}/${lid}`);
      const sBox = (stationEl as Element).getBoundingClientRect();
      const dBox = (stopEl as Element).getBoundingClientRect();
      return {
        x: dBox.x + dBox.width / 2 - (sBox.x + sBox.width / 2),
        y: dBox.y + dBox.height / 2 - (sBox.y + sBox.height / 2),
      };
    },
    { sid: stationId, lid: lineId },
  );
}

// StopGrid uses pointer events (not native HTML5 drag), so Playwright's
// dragTo is a no-op. Drive the gesture manually: down on source, threshold-
// crossing nudge, then move to the destination, up.
//
// Drop targets in the new editor are ghost slots that only render WHILE a
// drag is in progress, so we can't locate them by selector pre-drag. Instead,
// compute the screen-pixel destination from a (dRow, dCol) in the source's
// station-local frame by projecting through the SVG's CTM (which captures
// the editor's CSS rotation for the station's 8-way `rotation`).
async function dragStopByLocalDelta(
  page: Page,
  fromSel: string,
  dRow: number,
  dCol: number,
): Promise<void> {
  const fromBox = await page.locator(fromSel).boundingBox();
  if (!fromBox) throw new Error('drag source missing');
  const fx = fromBox.x + fromBox.width / 2;
  const fy = fromBox.y + fromBox.height / 2;

  const delta = await page.evaluate(
    ({ sel, dRow, dCol, PITCH }) => {
      const g = document.querySelector(sel);
      const svg = g?.closest('svg');
      const ctm = svg?.getScreenCTM();
      if (!ctm) return null;
      // Linear-part transform of the (dCol·PITCH, dRow·PITCH) SVG vector.
      return {
        x: dCol * PITCH * ctm.a + dRow * PITCH * ctm.c,
        y: dCol * PITCH * ctm.b + dRow * PITCH * ctm.d,
      };
    },
    { sel: fromSel, dRow, dCol, PITCH },
  );
  if (!delta) throw new Error('no editor svg CTM');
  const tx = fx + delta.x;
  const ty = fy + delta.y;

  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 6, fy + 6);
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('matching — visually-identical mirror stations', () => {
  test('"all" button counts a 180° layout-mirror as a match', async ({ page }) => {
    await seedAndOpen(page, mirroredTrio);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    const allBtn = page.getByRole('button', { name: 'all', exact: true });
    await expect(allBtn).toBeEnabled();
    // Title text encodes the match count — exact "2 matching neighbors"
    // proves both B (trivially identical) and C (180° mirror) were matched.
    await expect(allBtn).toHaveAttribute('title', /Mirror layout edits to 2 matching neighbors/);
  });

  test('moveStop under "all" mode keeps mirror stations visually in sync', async ({ page }) => {
    await seedAndOpen(page, mirroredTrio);

    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'all', exact: true }).click();

    const before = {
      A: await stopWorldOffset(page, 'A', 'L1'),
      B: await stopWorldOffset(page, 'B', 'L1'),
      C: await stopWorldOffset(page, 'C', 'L1'),
    };

    // Drag A's L1 stop one cell south in A's local frame: (row=0,col=0) →
    // (row=1,col=0). With mirror "all" engaged, B should track in step (it's
    // a trivial match) and C should also track — but only if Part 2's edit-
    // rotation transform is in place. Without it, C's stop moves the
    // opposite world direction.
    await dragStopByLocalDelta(
      page,
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
      1,
      0,
    );

    const after = {
      A: await stopWorldOffset(page, 'A', 'L1'),
      B: await stopWorldOffset(page, 'B', 'L1'),
      C: await stopWorldOffset(page, 'C', 'L1'),
    };

    const dA = { x: after.A.x - before.A.x, y: after.A.y - before.A.y };
    const dB = { x: after.B.x - before.B.x, y: after.B.y - before.B.y };
    const dC = { x: after.C.x - before.C.x, y: after.C.y - before.C.y };

    // Sanity: A actually moved south.
    expect(dA.y).toBeGreaterThan(0);
    // The whole point: B and C move by the same world vector as A.
    expect(dB).toEqual(dA);
    expect(dC).toEqual(dA);
  });
});
