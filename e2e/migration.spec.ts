import { test, expect, type Page } from '@playwright/test';
import { stationCenter } from './fixtures';

// Seed `localStorage` with a doc whose stop orientations use the *legacy*
// explicit cardinals (`up`/`down`/`left`/`right`) and an unknown garbage
// value. Reload — `parse()` migrates everything to the four canonical auto-*
// orientations.
//
// Bypasses `seedAndOpen` here because its TS-typed `Seed` only accepts
// canonical orientations; this test specifically needs to inject legacy
// strings.
async function seedRaw(page: Page, persisted: unknown): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([key, value, viewportKey, viewport]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(viewportKey as string, viewport as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify(persisted),
      'massimo-viewport',
      JSON.stringify({ state: { x: 0, y: 0, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
}

const baseStation = (
  id: string,
  x: number,
  y: number,
  lineId: string,
  orientation: string,
): Record<string, unknown> => ({
  id,
  name: id,
  x,
  y,
  rotation: 0,
  stops: [{ lineId, row: 0, col: 0, orientation }],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

// Selecting a station and opening its layout editor shows the L1 stop handle;
// shows the orientation as a glyph (↕ / ⤢ / ↔ / ⤡). Reading the glyph is the
// most reliable way to confirm migration without depending on store internals.
async function orientationGlyphFor(page: Page, stationId: string): Promise<string> {
  const center = await stationCenter(page, stationId);
  await page.mouse.click(center.x, center.y);
  await page.getByRole('button', { name: 'Edit layout' }).click();
  const cell = page.locator(
    '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
  );
  await expect(cell).toBeVisible();
  const glyph = (await cell.locator('text').textContent()) ?? '';
  // Exit the layout-edit mode before the caller moves to the NEXT station —
  // the mode pins the station popover to the top-right of the canvas, where
  // it would swallow the click selecting a station that projects under it.
  await page.keyboard.press('Escape');
  return glyph;
}

test.describe('Legacy dotShape migration on load (v6 → v7)', () => {
  test('per-stop dotShape and line defaultDotShape strings convert to DotStyle objects', async ({
    page,
  }) => {
    // Simulate a doc saved at persist version 6, when stop glyphs were still
    // the `dotShape` enum strings (per-stop) and `defaultDotShape` (per-line).
    // The store's `migrate` hook converts both to procedural DotStyle objects.
    const stop = (lineId: string, dotShape?: string) => ({
      lineId,
      row: 0,
      col: 0,
      orientation: 'auto-vertical',
      ...(dotShape ? { dotShape } : {}),
    });
    const persisted = {
      state: {
        stations: {
          // Per-stop override survives conversion.
          A: {
            ...baseStation('A', -300, 0, 'L1', 'auto-vertical'),
            stops: [stop('L1', 'filled-black-diamond')],
          },
          // No override — tracks the line's converted default (open-white).
          B: { ...baseStation('B', -150, 0, 'L1', 'auto-vertical'), stops: [stop('L1')] },
          // 'none' converts to the invisible style: no glyph element at all.
          C: { ...baseStation('C', 0, 0, 'L1', 'auto-vertical'), stops: [stop('L1', 'none')] },
        },
        lines: {
          L1: {
            id: 'L1',
            service: 'L',
            name: 'L line',
            color: '#0039a6',
            stations: ['A', 'B', 'C'],
            defaultDotShape: 'open-white',
          },
        },
        lineOrder: ['L1'],
        curveRadius: 24,
        lineCounter: 1,
        lineTags: {},
        routeBullets: {},
        transfers: {},
      },
      version: 6,
    };

    // Gate: no console errors during load + initial render.
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await seedRaw(page, persisted);

    // A: the per-stop diamond override, now a black diamond polygon.
    const a = page.locator('[data-stop-station="A"][data-stop-line="L1"]');
    await expect(a).toBeVisible();
    await expect(a).toHaveAttribute('data-stop-shape', 'diamond');
    await expect(a).toHaveJSProperty('tagName', 'polygon');
    await expect(a).toHaveAttribute('fill', '#000000');

    // B: the line default (open-white) — a transparent circle with a white stroke.
    const b = page.locator('[data-stop-station="B"][data-stop-line="L1"]');
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute('data-stop-shape', 'circle');
    await expect(b).toHaveAttribute('fill', 'none');
    await expect(b).toHaveAttribute('stroke', '#ffffff');
    await expect(b).toHaveAttribute('stroke-width', '1.5');

    // C: 'none' renders no glyph element.
    await expect(page.locator('[data-stop-station="C"][data-stop-shape]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});

test.describe('Legacy inline bullet syntax migration on load (v7 → v8)', () => {
  test('angle tokens become paren bullets; pre-existing paren text stays literal', async ({
    page,
  }) => {
    // Simulate a doc saved at persist version 7, under the old grammar where
    // `<A>` was the circle bullet and pipes were plain text. The migrate hook
    // rewrites `<A>` → `|A|` and escapes the literal `|lit|` so neither the
    // station name nor the label text changes its rendering.
    const persisted = {
      state: {
        stations: {
          A: { ...baseStation('A', -150, 0, 'L1', 'auto-vertical'), name: 'Hub <A> |lit|' },
        },
        lines: {
          L1: { id: 'L1', service: 'A', name: 'A line', color: '#0039a6', stations: ['A'] },
        },
        lineOrder: ['L1'],
        textLabels: {
          g1: {
            id: 'g1',
            x: 150,
            y: 100,
            rotation: 0,
            text: 'Ride <A>',
            fontSize: 16,
            weight: 400,
            italic: false,
            align: 'left',
            color: '#111111',
            darkColor: '#ffffff',
          },
        },
        curveRadius: 24,
        lineCounter: 1,
        lineTags: {},
        routeBullets: {},
        transfers: {},
      },
      version: 7,
    };

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await seedRaw(page, persisted);

    // The free text label renders its migrated token as an inline bullet in
    // the line color.
    const labelBullet = page.locator('[data-text-label-id="g1"] [data-inline-bullet="A"]');
    await expect(labelBullet).toBeVisible();
    await expect(labelBullet.locator('circle')).toHaveAttribute('fill', '#0039a6');

    // The station name renders one too, on both of its surfaces: the canvas
    // label (SVG) and the sidebar station list (HTML badge) — three "A"
    // bullets in total across the app.
    await expect(page.locator('.canvas-host svg [data-inline-bullet="A"]')).toHaveCount(2);
    await expect(page.locator('[data-inline-bullet="A"]')).toHaveCount(3);

    // The literal "|lit|" was escaped, not turned into a bullet.
    await expect(page.locator('[data-inline-bullet="lit"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});

test.describe('Legacy stop-orientation migration on load', () => {
  test('up/down/left/right + unknown values migrate to the canonical auto-* axes', async ({
    page,
  }) => {
    // Simulate a doc saved by an earlier app version (pre-diagonal-stops).
    // version: 1 — the previous persist schema; the store's `migrate` hook
    // promotes it to the current schema by migrating any legacy stop
    // orientations along the way.
    const persisted = {
      state: {
        stations: {
          A: baseStation('A', -300, 0, 'L1', 'up'),
          B: baseStation('B', -150, 0, 'L1', 'down'),
          C: baseStation('C', 0, 0, 'L1', 'left'),
          D: baseStation('D', 150, 0, 'L1', 'right'),
          E: baseStation('E', 300, 0, 'L1', 'gibberish'),
        },
        lines: {
          L1: {
            id: 'L1',
            service: 'L',
            name: 'L line',
            color: '#0039A6',
            stations: ['A', 'B', 'C', 'D', 'E'],
          },
        },
        lineOrder: ['L1'],
        curveRadius: 24,
        lineCounter: 1,
        lineTags: {},
        routeBullets: {},
        transfers: {},
      },
      version: 1,
    };

    // Gate: no console errors during load + initial render.
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await seedRaw(page, persisted);

    // The sidebar is irrelevant to migration; close it so the per-station editor
    // popovers (which now stack BELOW the sidebar) aren't tucked behind it for
    // stations near the right edge — orientationGlyphFor clicks each one's
    // "Edit layout" button, which would otherwise be intercepted by the panel.
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(page.locator('.sidebar')).toHaveCount(0);

    // Each station's stop should be visible (didn't crash on the legacy strings).
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      await expect(page.locator(`[data-stop-station="${id}"][data-stop-line="L1"]`)).toBeVisible();
    }

    expect(errors).toEqual([]);

    // up/down → auto-vertical (↕); left/right → auto-horizontal (↔);
    // garbage → auto-vertical fallback (↕).
    expect(await orientationGlyphFor(page, 'A')).toBe('↕');
    expect(await orientationGlyphFor(page, 'B')).toBe('↕');
    expect(await orientationGlyphFor(page, 'C')).toBe('↔');
    expect(await orientationGlyphFor(page, 'D')).toBe('↔');
    expect(await orientationGlyphFor(page, 'E')).toBe('↕');
  });
});
