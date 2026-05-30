import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, type Seed } from './fixtures';

// World cap-line y at the layered end of band A|B for a 1-stripe vertical
// band. The dashed-outline `<line>` cap is perpendicular to the centerline
// (horizontal here), so y1 === y2 — read either one.
async function dashedCapEndY(page: Page, bandKey: string): Promise<number> {
  return await page.evaluate((key) => {
    const group = document.querySelector(
      `[data-layering-outline][data-band-key="${key}"]`,
    ) as SVGGElement | null;
    if (!group) throw new Error(`no dashed-outline group for band ${key}`);
    const lines = group.querySelectorAll('line');
    // Order from <LayeringDashedOutlines>: capStart first, then capEnd.
    if (lines.length !== 2) throw new Error(`expected 2 cap lines, got ${lines.length}`);
    const y1 = lines[1].getAttribute('y1');
    if (y1 === null) throw new Error('capEnd has no y1');
    return parseFloat(y1);
  }, bandKey);
}

// Click the band-stripe path by its bandKey + lineId. The path has fill=none
// (transparent interior), which fails Playwright's "actionable" visibility
// heuristic — but the stroke captures pointer events and a center-bbox
// click lands on it for a straight single-stripe band. `force: true` skips
// the heuristic; the element exists in the DOM, the React handler runs.
//
// `position` is relative to the element's bounding-box top-left and is
// useful when the bbox center lies under another band (crossing) — pass an
// off-center spot that's still on the stripe but clear of any front-of
// crossing.
async function clickStripe(
  page: Page,
  bandKey: string,
  lineId: string,
  opts: { button?: 'left' | 'right'; position?: { x: number; y: number } } = {},
): Promise<void> {
  const stripe = page.locator(
    `[data-band-stripe][data-band-key="${bandKey}"][data-line-id="${lineId}"]`,
  );
  await stripe.click({ button: opts.button ?? 'left', force: true, position: opts.position });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test.describe('Layering mode — L key, click-to-cycle, z-order, outline', () => {
  // Two-station horizontal band: A — B at y=0. One line L1.
  const oneSegment: Seed = {
    stations: [
      { id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
      { id: 'B', name: 'B', x: 200, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    ],
    lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B'] }],
  };

  test('L toggles layering mode on and off', async ({ page }) => {
    await seedAndOpen(page, oneSegment);
    const host = page.locator('.canvas-host');
    await expect(host).toHaveAttribute('data-uimode', 'idle');

    await page.keyboard.press('l');
    await expect(host).toHaveAttribute('data-uimode', 'layering');

    await page.keyboard.press('l');
    await expect(host).toHaveAttribute('data-uimode', 'idle');
  });

  test('left-click bumps the segment layer, right-click decrements it', async ({ page }) => {
    await seedAndOpen(page, oneSegment);
    await page.keyboard.press('l');

    const label = page.locator('[data-layer-number][data-line-id="L1"]');
    // Layer 0 → no label (and not hovered after the click + mouse move away).
    await expect(label).toHaveCount(0);

    await clickStripe(page, 'A|B#L1', 'L1');
    await expect(label).toHaveText('+1');

    await clickStripe(page, 'A|B#L1', 'L1');
    await expect(label).toHaveText('+2');

    await clickStripe(page, 'A|B#L1', 'L1', { button: 'right' });
    await expect(label).toHaveText('+1');

    await clickStripe(page, 'A|B#L1', 'L1', { button: 'right' });
    // Back to 0 — but the cursor is still over the stripe, which keeps the
    // hovered '0' label visible. Move the cursor off-canvas first.
    await page.mouse.move(0, 0);
    await expect(label).toHaveCount(0);
  });

  test('bumping a back-line segment to +1 paints it in front of the crossing line', async ({
    page,
  }) => {
    // Two crossing lines, no shared stations:
    //   V: vertical, V1 (0,-50) — V2 (0,50). lineOrder[1] → BACK by default.
    //   H: horizontal, H1 (-50,0) — H2 (50,0). lineOrder[0] → FRONT.
    // After bumping V's segment to +1, V should paint LATER in DOM order
    // (i.e. on top). DOM-order proxy for z avoids fishing for stroke colors
    // at the crossing pixel.
    const crossing: Seed = {
      stations: [
        { id: 'V1', name: 'V1', x: 0, y: -50, stops: [{ lineId: 'V', row: 0, col: 0 }] },
        { id: 'V2', name: 'V2', x: 0, y: 50, stops: [{ lineId: 'V', row: 0, col: 0 }] },
        { id: 'H1', name: 'H1', x: -50, y: 0, stops: [{ lineId: 'H', row: 0, col: 0 }] },
        { id: 'H2', name: 'H2', x: 50, y: 0, stops: [{ lineId: 'H', row: 0, col: 0 }] },
      ],
      lines: [
        { id: 'H', service: 'H', color: '#0039A6', stations: ['H1', 'H2'] }, // front
        { id: 'V', service: 'V', color: '#EE352E', stations: ['V1', 'V2'] }, // back
      ],
    };
    await seedAndOpen(page, crossing);

    const compareDomOrder = async (): Promise<number> =>
      page.evaluate(() => {
        const v = document.querySelector(
          '[data-band-stripe][data-band-key="V1|V2#V"]',
        ) as Element | null;
        const h = document.querySelector(
          '[data-band-stripe][data-band-key="H1|H2#H"]',
        ) as Element | null;
        if (!v || !h) throw new Error('missing band stripe');
        // -1 if v appears before h; +1 if v appears after h.
        const cmp = v.compareDocumentPosition(h);
        if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return +1;
        return 0;
      });

    // Default: V is behind (drawn first / earlier in DOM).
    expect(await compareDomOrder()).toBe(-1);

    await page.keyboard.press('l');
    // Click off-center on V (away from the (0,0) crossing where H paints in
    // front). V's stripe bbox spans world y=-50 to y=+50 with stroke width 14;
    // position { x: 7, y: 12.5 } in bbox-relative coords lands at world
    // (0, -37.5) — solidly on V, clear of H's ±7 stroke at y=0.
    await clickStripe(page, 'V1|V2#V', 'V', { position: { x: 7, y: 12.5 } });

    // After bumping: V now after H in DOM → painted on top.
    expect(await compareDomOrder()).toBe(+1);
  });

  test('the cap line at a "win" endpoint extends outward by half STOP_SIZE', async ({ page }) => {
    // Three-station vertical line A — B — C. Layering the first segment
    // (A|B) to -1 makes both endpoints "win":
    //   - A: terminus (1 adjacency, layered) → win → cap extends to y=-7
    //   - B: two adjacencies, A|B (-1) beats B|C (0) → win → cap extends to y=107
    // We assert the B-end cap is at 107 (the non-default value), with a
    // tolerance well inside STOP_SIZE/2 = 7.
    const threeVertical: Seed = {
      stations: [
        { id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
        { id: 'B', name: 'B', x: 0, y: 100, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
        { id: 'C', name: 'C', x: 0, y: 200, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
      ],
      lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C'] }],
    };
    await seedAndOpen(page, threeVertical);
    await page.keyboard.press('l');
    // Right-click the A|B stripe to set its layer to -1.
    await clickStripe(page, 'A|B#L1', 'L1', { button: 'right' });
    // After the click the cursor sits on the stripe, marking it hovered →
    // LayeringHoverOutline takes over and LayeringDashedOutlines skips it.
    // Move the mouse off the canvas so the dashed outline (which carries the
    // numeric cap-line attributes) renders again.
    await page.mouse.move(0, 0);

    // The dashed outline for A|B is now showing. Read its end-cap y. With no
    // layer, capEnd.y = 100 (band end at B). After "win" adjustment, capEnd
    // shifts OUTWARD along the centerline tangent → y = 107.
    const capEndY = await dashedCapEndY(page, 'A|B#L1');
    expect(Math.abs(capEndY - 107)).toBeLessThan(0.5);
  });

  test('Esc exits layering mode and tears down its overlays', async ({ page }) => {
    await seedAndOpen(page, oneSegment);
    await page.keyboard.press('l');
    await expect(page.locator('.canvas-host')).toHaveAttribute('data-uimode', 'layering');
    await expect(page.locator('[data-layering-outline]')).not.toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.canvas-host')).toHaveAttribute('data-uimode', 'idle');
    await expect(page.locator('[data-layering-outline]')).toHaveCount(0);
  });
});
