/**
 * Baseline measurement: in a real map's exported PDF, how much of the content
 * stream is outlined glyph geometry vs everything else (line bands, stripes,
 * clips, images)?
 *
 * Loads two real map files through the actual open path (hidden file input in
 * the Toolbar — the same one e2e/loadHardening.spec.ts and
 * e2e/loadRecenter.spec.ts drive), exports a PDF exactly as e2e/exportPdf.spec.ts
 * does, and inflates the content streams with the verbatim `operators()` helper
 * from that spec. Each map is measured twice: as-is, and with every station name
 * and text label emptied (a same-geometry, no-text variant) — the diff between
 * the two isolates text's share of the output.
 *
 * Inputs and per-measurement results BOTH live in .perf/, never in
 * test-results/: Playwright's `outputDir` defaults there and is `rm -rf`'d before
 * every run, so anything staged there is destroyed before the first test starts.
 * `.perf/*.massimo.json` and `.perf/*.local.*` are already gitignored, which is
 * why those two name shapes are used here.
 *
 * Set `PDF_BASELINE_TAG` to label a run (e.g. `before`/`after`) so two runs can
 * be compared without overwriting each other.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERF_DIR = path.resolve(__dirname, '..');
const TAG = process.env.PDF_BASELINE_TAG ?? 'run';

async function exportPdf(page: Page): Promise<Download> {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  return downloadPromise;
}

/**
 * Inflate every Flate content stream and concatenate the operators.
 * Verbatim from e2e/exportPdf.spec.ts (the 'outlined glyphs actually reach
 * the PDF' test).
 */
const operators = (pdf: Buffer): string => {
  // Walked by index, not by regex: the payloads are binary.
  const open = Buffer.from('stream');
  const close = Buffer.from('endstream');
  let out = '';
  for (let i = pdf.indexOf(open); i !== -1; i = pdf.indexOf(open, i + 1)) {
    if (pdf.subarray(i - 3, i).toString('latin1') === 'end') continue; // 'endstream'
    let start = i + open.length;
    if (pdf[start] === 0x0d) start++; // CR
    if (pdf[start] === 0x0a) start++; // LF
    const end = pdf.indexOf(close, start);
    if (end === -1) continue;
    try {
      out += inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      // Not a Flate stream (an image XObject, say) — skip it.
    }
  }
  return out;
};

const TRACKED_OPS = ['m', 'l', 'c', 'f', 're', 'W', 'q', 'Do'] as const;
type OpName = (typeof TRACKED_OPS)[number];

/** Whole-token operator counts — split on whitespace, exact match only. */
function countOps(ops: string): Record<OpName, number> {
  const counts = Object.fromEntries(TRACKED_OPS.map((op) => [op, 0])) as Record<OpName, number>;
  for (const token of ops.split(/\s+/)) {
    if ((TRACKED_OPS as readonly string[]).includes(token)) counts[token as OpName]++;
  }
  return counts;
}

async function loadMapFile(page: Page, filePath: string, expectedStationCount: number) {
  await page.goto('/');
  await page.locator('input[accept*="massimo"]').setInputFiles({
    name: path.basename(filePath),
    mimeType: 'application/json',
    buffer: readFileSync(filePath),
  });
  await page.waitForSelector('.canvas-host svg', { timeout: 60_000 });
  // Confirm the real content actually rendered before exporting, not just an
  // empty canvas the file picker silently failed to populate.
  await expect(page.locator('[data-station-id]')).toHaveCount(expectedStationCount, {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

interface Measurement {
  label: string;
  fileBytes: number;
  opsLength: number;
  counts: Record<OpName, number>;
}

async function measure(page: Page, label: string, filePath: string, stationCount: number) {
  await loadMapFile(page, filePath, stationCount);
  const download = await exportPdf(page);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`${label}: download has no path`);
  const bytes = readFileSync(downloadPath);
  expect(bytes.subarray(0, 5).toString('latin1'), `${label}: valid PDF header`).toBe('%PDF-');

  const ops = operators(bytes);
  expect(ops.length, `${label}: content streams should inflate to something`).toBeGreaterThan(0);

  const result: Measurement = {
    label,
    fileBytes: bytes.length,
    opsLength: ops.length,
    counts: countOps(ops),
  };
  writeFileSync(
    path.join(PERF_DIR, `pdfops-${TAG}-${label}.local.json`),
    JSON.stringify(result, null, 2),
  );
  return result;
}

/** Doc field counts, so the harness fails loudly instead of silently loading nothing. */
function readStationCount(filePath: string): number {
  const json = JSON.parse(readFileSync(filePath, 'utf8'));
  return Object.keys(json.doc.stations ?? {}).length;
}

/**
 * Write a same-geometry, text-blanked twin of a map file: every station name
 * and text-label string emptied, everything else untouched. The diff between
 * the as-is export and this export's operator counts isolates text's
 * contribution to the content stream.
 */
function writeTextBlankedVariant(srcPath: string, destPath: string): void {
  const json = JSON.parse(readFileSync(srcPath, 'utf8'));
  const doc = json.doc;
  for (const station of Object.values(doc.stations ?? {}) as Array<{ name?: string }>) {
    station.name = '';
  }
  for (const label of Object.values(doc.textLabels ?? {}) as Array<{ text?: string }>) {
    label.text = '';
  }
  writeFileSync(destPath, JSON.stringify(json));
}

// Private map fixtures (gitignored). A missing one skips rather than fails, so
// the harness still runs for whoever has only some of them.
const MAPS: { name: string; file: string }[] = [
  { name: 'mta', file: 'mta-v67d.massimo.json' },
  { name: 'furta', file: 'furta-v34.massimo.json' },
];

for (const { name, file } of MAPS) {
  test.describe(name, () => {
    const srcPath = path.join(PERF_DIR, file);
    const blankedPath = path.join(PERF_DIR, `${name}-blanked.massimo.json`);
    test.skip(!existsSync(srcPath), `${file} not present in .perf/`);
    const stationCount = existsSync(srcPath) ? readStationCount(srcPath) : 0;

    test.beforeAll(() => {
      writeTextBlankedVariant(srcPath, blankedPath);
    });

    test(`${name} — as-is`, async ({ page }) => {
      test.setTimeout(600_000);
      await measure(page, `${name}-with-text`, srcPath, stationCount);
    });

    test(`${name} — text blanked`, async ({ page }) => {
      test.setTimeout(600_000);
      await measure(page, `${name}-text-blanked`, blankedPath, stationCount);
    });
  });
}
