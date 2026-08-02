/* THROWAWAY: INTERLEAVED A/B of the body-mask spike, in one page session.
 *
 * Sequential runs on this codebase are JIT noise (the Jul-29 expedition's own
 * finding, and this harness shows +/-25% run to run). So: same page, same warm
 * JIT, alternate masked and unmasked blocks, and report the paired difference.
 *
 *   PORT=5234 npx playwright test -c playwright.perf-prod.config.ts e2e/perf-ab.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';

const TARGETS = (process.env.PERF_TARGETS ?? 'Times Sq,Atlantic-Barclays,Halsey').split(',');
const BLOCKS = Number(process.env.PERF_BLOCKS ?? 6); // alternating A/B blocks
const MOVES = Number(process.env.PERF_MOVES ?? 10); // moves per block

interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number; stops: unknown[] }>;
  [k: string]: unknown;
}

async function seedAt(page: Page, doc: DocShape, c: { x: number; y: number }) {
  await page.goto('/');
  await page.evaluate(
    ([k, v, vk, vv]) => {
      localStorage.setItem(k as string, v as string);
      localStorage.setItem(vk as string, vv as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-viewport',
      JSON.stringify({ state: { x: c.x, y: c.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
  await page.waitForTimeout(1500);
}

test('interleaved A/B: body masks on vs off', async ({ page }) => {
  test.setTimeout(900_000);
  const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;

  for (const frag of TARGETS) {
    const st = Object.values(doc.stations).find((s) =>
      s.name.toLowerCase().replace(/\s+/g, ' ').includes(frag.toLowerCase().trim()),
    );
    if (!st) continue;
    await seedAt(page, doc, { x: st.x, y: st.y });

    const host = (await page.locator('.canvas-host').boundingBox())!;
    const hit = await page.evaluate(
      ([sid, ox, oy]) => {
        const at = (x: number, y: number) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-station-id]')
            ?.getAttribute('data-station-id') ?? null;
        if (at(ox as number, oy as number) === sid) return { x: ox, y: oy };
        for (let r = 2; r <= 26; r += 2)
          for (let a = 0; a < 16; a++) {
            const x = Math.round((ox as number) + r * Math.cos((a * Math.PI) / 8));
            const y = Math.round((oy as number) + r * Math.sin((a * Math.PI) / 8));
            if (at(x, y) === sid) return { x, y };
          }
        return null;
      },
      [st.id, Math.round(host.x + host.width / 2), Math.round(host.y + host.height / 2)],
    );
    if (!hit) {
      console.log(`!! ${st.name}: unreachable; skipping`);
      continue;
    }
    const cx = hit.x as number;
    const cy = hit.y as number;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 6, cy + 4);
    await page.waitForTimeout(500);

    const res = await page.evaluate(
      async ([sx, sy, blocks, moves]) => {
        const svg = document.querySelector('.canvas-host svg')!;
        const g = globalThis as unknown as { __MASKS?: boolean };
        const on: number[] = [];
        const off: number[] = [];
        let step = 0;
        const runBlock = async (masks: boolean, sink: number[]) => {
          g.__MASKS = masks;
          // One discarded move so the toggle's first frame (cold masks) is not
          // charged to the block.
          for (let i = 0; i <= (moves as number); i++) {
            step++;
            const t0 = performance.now();
            svg.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                clientX: (sx as number) + 6 + step * 1.5,
                clientY: (sy as number) + 4 + step * 1.1,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse',
              }),
            );
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            if (i > 0) sink.push(performance.now() - t0);
          }
        };
        for (let b = 0; b < (blocks as number); b++) {
          // Alternate the leading arm each pair so drift cannot favour one.
          if (b % 2 === 0) {
            await runBlock(false, off);
            await runBlock(true, on);
          } else {
            await runBlock(true, on);
            await runBlock(false, off);
          }
        }
        g.__MASKS = true;
        return { on, off };
      },
      [cx, cy, BLOCKS, MOVES],
    );
    await page.mouse.up();

    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const mOff = med(res.off);
    const mOn = med(res.on);
    console.log(
      `\n[${st.name.replace(/\n/g, ' ')}] n=${res.on.length} per arm, interleaved\n` +
        `  masks OFF  med=${mOff.toFixed(1)}ms  mean=${mean(res.off).toFixed(1)}ms  ` +
        `min=${Math.min(...res.off).toFixed(1)}\n` +
        `  masks ON   med=${mOn.toFixed(1)}ms  mean=${mean(res.on).toFixed(1)}ms  ` +
        `min=${Math.min(...res.on).toFixed(1)}\n` +
        `  => ${(mOff / mOn).toFixed(2)}x on the median frame`,
    );
  }
  expect(true).toBe(true);
});
