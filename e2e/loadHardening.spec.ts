import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, fourInLine } from './fixtures';

// The two ends of the import-hardening contract, through the REAL file input:
// a file the parser cannot honour surfaces an error toast and leaves the open
// document untouched; a generator-broken file whose damage is reconstructible
// (the motivating case: full edges, empty membership) loads silently repaired
// — and is then actually EDITABLE, which is what the un-repaired form wasn't.

const loadFile = (page: Page, doc: unknown) =>
  page.locator('input[accept*="massimo"]').setInputFiles({
    name: 'broken.massimo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'massimo-map', version: 2, doc })),
  });

const station = (id: string, x: number) => ({
  id,
  name: id,
  x,
  y: 0,
  rotation: 0,
  stops: [{ lineId: 'T', row: 0, col: 0, orientation: 'auto-horizontal' }],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
});

test('a file the parser cannot honour raises a toast and keeps the open map', async ({ page }) => {
  await seedAndOpen(page, fourInLine);

  await loadFile(page, {
    stations: { s1: { ...station('s1', 0), stops: 'nope' } },
    lines: {},
    lineOrder: [],
  });

  // The refusal names the offending station in a persistent error toast…
  await expect(page.locator('.status-toast')).toContainText('s1');
  // …and the previously open document is still on the canvas, untouched.
  await expect(page.locator('[data-station-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-station-id="s1"]')).toHaveCount(0);
});

test('a membership-stripped file loads repaired and is editable', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The real-world generator bug: a full edge set but `stations: []` — bands
  // rendered, but every editor works off membership, so nothing was editable.
  await loadFile(page, {
    name: 'Opus case',
    stations: { s1: station('s1', 0), s2: station('s2', 300), s3: station('s3', 600) },
    lines: {
      T: {
        id: 'T',
        service: 'T',
        name: 'T line',
        color: '#0039A6',
        stations: [],
        edges: ['s1|s2', 's2|s3'],
      },
    },
    lineOrder: ['T'],
  });

  await expect(page.locator('[data-station-id]')).toHaveCount(3);
  await expect(page.locator('.status-toast')).toHaveCount(0);

  // Editable, not just renderable: deleting the middle station must take its
  // edges with it (membership is what the delete cascade walks).
  const dot = await page.locator('[data-station-id="s2"]').boundingBox();
  expect(dot).not.toBeNull();
  await page.mouse.click(dot!.x + dot!.width / 2, dot!.y + dot!.height / 2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-station-id]')).toHaveCount(2);
  await expect(page.locator('[data-station-id="s2"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
