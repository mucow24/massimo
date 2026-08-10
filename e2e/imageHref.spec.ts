import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

// Every image a map carries is inline bytes — that is what lets a map paint
// without reaching the network and an export be genuinely self-contained. The
// guard had one caller (the clipboard), so a doc that acquired a remote href
// kept it: the browser fetched it on every paint and it rode into every SVG,
// PNG and PDF export.
//
// This has to run against the REHYDRATE path in a real app boot, at the CURRENT
// persist version. zustand calls `migrate` only when the stored version differs
// from the config one, so a doc saved by this build never reaches migrateDoc at
// all — the repair has to be in the `merge` hook, and only a boot proves it is.

const REMOTE = 'https://tracker.example/px.png';
const INLINE = 'data:image/svg+xml;base64,PHN2Zy8+';

// MUST equal the persist config's `version` in src/state/store.ts. The whole
// point of this spec is that a doc at the CURRENT version skips migrateDoc, so
// only the merge hook can repair it — seeded one version behind, the test would
// silently degrade to exercising `migrate` instead and keep passing. Pinned by
// reading the config off disk (same pattern as theme.test.ts and styles.css),
// so a version bump goes red here instead of quietly retargeting the spec.
const CURRENT_PERSIST_VERSION = 26;

test('the seeded version IS the persist config version (drift guard)', () => {
  const storePath = fileURLToPath(new URL('../src/state/store.ts', import.meta.url));
  const store = readFileSync(storePath, 'utf8');
  const m = /name: 'vignelli-map-doc-v1',[\s\S]*?version: (\d+),/.exec(store);
  expect(m, 'persist config not found in store.ts').not.toBeNull();
  expect(Number(m![1])).toBe(CURRENT_PERSIST_VERSION);
});

const image = (id: string, href: string) => ({
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  rotation: 0,
  href,
});

async function bootWith(page: Page, hrefs: Record<string, string>): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([key, value, viewportKey, viewport]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(viewportKey as string, viewport as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify({
        state: {
          stations: {},
          lines: {},
          lineOrder: [],
          svgImages: Object.fromEntries(
            Object.entries(hrefs).map(([id, href]) => [id, image(id, href)]),
          ),
          backgroundOrder: Object.keys(hrefs),
        },
        // The CURRENT persist version (drift-guarded above): migrateDoc is
        // skipped entirely.
        version: CURRENT_PERSIST_VERSION,
      }),
      'massimo-viewport',
      JSON.stringify({ state: { x: 0, y: 0, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
}

// The doc the app is actually holding — what a save, a library version and
// every export are cut from. (The localStorage blob itself is only rewritten by
// the next doc edit; the boot repair is re-applied every time until then.)
const liveImageIds = (page: Page) =>
  page.locator('[data-svg-image-id]').evaluateAll((els) =>
    Array.from(new Set(els.map((el) => el.getAttribute('data-svg-image-id')))).sort(),
  );

test.describe('Remote image hrefs on rehydrate', () => {
  test('an image with a remote href is dropped on boot, and never requested', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await bootWith(page, { bad: REMOTE });

    await expect(page.locator(`image[href="${REMOTE}"]`)).toHaveCount(0);
    expect(await liveImageIds(page)).toEqual([]);
    expect(requested.filter((u) => u.startsWith('https://tracker.example'))).toEqual([]);
  });

  test('an inline data URI survives the same boot (control)', async ({ page }) => {
    await bootWith(page, { good: INLINE });

    await expect(page.locator(`image[href="${INLINE}"]`)).toHaveCount(1);
    expect(await liveImageIds(page)).toEqual(['good']);
  });
});
