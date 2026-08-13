import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine } from './fixtures';

// Line END styles, through the two surfaces that set them: the line editor
// (the whole line's ends) and the station editor's stop row (one terminus).
//
// What only a browser can check here is the SHAPE: the marker at a terminus
// stops being a <rect> and becomes a filled <path>, and for a round end that
// path carries an arc that bulges OUTWARD. A unit test can assert the `d`
// string; only a real renderer can be asked whether a point is inside the fill.

// fourInLine runs A–B–C–D along y=0, so A and D are the line's two termini.
const stripe = (page: Page) => page.locator('[data-band-stripe][data-line-id="L1"]').first();

async function openLineEditor(page: Page): Promise<void> {
  await stripe(page).click({ force: true });
  await expect(page.locator('.append-banner')).toBeVisible();
  await page.getByRole('button', { name: /style detail/i }).click();
}

// The RESHAPED markers: a square end paints a <rect>, so a <path> filled in
// the line's color is exactly one end that is no longer square.
const reshapedEnds = (page: Page) => page.locator('path[fill="#0039A6"]');

async function storedLine(page: Page) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('vignelli-map-doc-v1');
    return JSON.parse(raw!).state.lines.L1 as {
      endStyle?: string;
      stationEndStyles?: Record<string, string>;
    };
  });
}

test.describe('Line ends — the line editor', () => {
  test('picking Round reshapes both termini and persists across a reload', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    // Before: every marker is the historical square <rect>.
    await expect(reshapedEnds(page)).toHaveCount(0);

    await openLineEditor(page);
    await page.getByRole('radio', { name: 'Round' }).click();
    expect((await storedLine(page)).endStyle).toBe('round');

    // Count after a reload rather than in Edit Stops: the highlight overlay
    // repaints the selected line's markers on top, so a selected line shows
    // each end twice. The reload also proves the field round-trips.
    await page.reload();
    const paths = reshapedEnds(page);
    // Exactly the two termini (A and D) reshape; B and C keep their squares.
    await expect(paths).toHaveCount(2);
    for (const d of await paths.evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''))) {
      expect(d).toContain('A '); // an arc, not a straight quad
    }
  });

  test('the round end bulges OUTWARD, past the stop centre', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await openLineEditor(page);
    await page.getByRole('radio', { name: 'Round' }).click();

    // D is the right-hand terminus at world x=300, so its end reaches east to
    // x=307 (half of the 14-unit width). Ask the renderer itself what it fills:
    // a flipped arc sweep would carve the bulge inward and fail `axisOut`.
    const hit = await page.evaluate(() => {
      const svg = document.querySelector('svg')!;
      const P = (x: number, y: number) => {
        const p = svg.createSVGPoint();
        p.x = x;
        p.y = y;
        return p;
      };
      // Pick the RIGHT-hand terminus by position. (Matching the `d` string on
      // "300.000000" would also match A at x=-300 — the substring is in both.)
      const el = [...document.querySelectorAll('path[fill="#0039A6"]')]
        .map((p) => p as SVGGeometryElement)
        .find((p) => p.getBBox().x > 0);
      if (!el) return null;
      return {
        axisOut: el.isPointInFill(P(305, 0)), // inside the half-disc
        beyond: el.isPointInFill(P(309, 0)), // past r=7
        corner: el.isPointInFill(P(305, 5)), // the square's corner, not the disc's
        inward: el.isPointInFill(P(295, 5)), // the rectangular half survives
      };
    });
    expect(hit).toEqual({ axisOut: true, beyond: false, corner: false, inward: true });
  });

  test('Short stops the line dead at the stop centre', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await openLineEditor(page);
    await page.getByRole('radio', { name: 'Short' }).click();

    const hit = await page.evaluate(() => {
      const svg = document.querySelector('svg')!;
      const P = (x: number, y: number) => {
        const p = svg.createSVGPoint();
        p.x = x;
        p.y = y;
        return p;
      };
      // Pick the RIGHT-hand terminus by position. (Matching the `d` string on
      // "300.000000" would also match A at x=-300 — the substring is in both.)
      const el = [...document.querySelectorAll('path[fill="#0039A6"]')]
        .map((p) => p as SVGGeometryElement)
        .find((p) => p.getBBox().x > 0);
      if (!el) return null;
      return {
        hasArc: (el.getAttribute('d') ?? '').includes('A '),
        pastCentre: el.isPointInFill(P(302, 0)),
        inward: el.isPointInFill(P(296, 5)),
      };
    });
    expect(hit).toEqual({ hasArc: false, pastCentre: false, inward: true });
  });
});

test.describe('Line ends — the per-terminus override', () => {
  test('the stop row pins one end, and greys the control out at an interior stop', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // B is interior for L1 — nothing to style there, so the control is present
    // (the columns hold their places) but disabled.
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);
    await expect(page.getByRole('combobox', { name: /^Line end/ })).toBeDisabled();
    // B's docked editor sits in the host's top-right corner, clear of A.

    // A is a terminus.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    const combo = page.getByRole('combobox', { name: /^Line end/ });
    await expect(combo).toBeVisible();
    await combo.click();
    await page.getByRole('option', { name: 'Round' }).click();

    expect((await storedLine(page)).stationEndStyles).toEqual({ A: 'round' });
    // Only A reshaped — D is still the line's square default.
    await expect(reshapedEnds(page)).toHaveCount(1);
  });

  test('a pin survives a reload and still paints', async ({ page }) => {
    // The prune-on-topology rule is pinned by unit tests; what only a browser
    // can show is that a pin round-trips through localStorage rehydration and
    // comes back painting the shape it named.
    await seedAndOpen(page, fourInLine);
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('combobox', { name: /^Line end/ }).click();
    await page.getByRole('option', { name: 'Short' }).click();
    expect((await storedLine(page)).stationEndStyles).toEqual({ A: 'short' });

    await page.reload();
    expect((await storedLine(page)).stationEndStyles).toEqual({ A: 'short' });
    const paths = reshapedEnds(page);
    await expect(paths).toHaveCount(1);
    // Short, not round — the pin's own value, not the line's square default.
    expect(await paths.first().getAttribute('d')).not.toContain('A ');
  });
});
