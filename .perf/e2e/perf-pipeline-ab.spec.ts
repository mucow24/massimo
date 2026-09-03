/* INTERLEAVED A/B of the region worker pipeline, in one page session.
 *
 * Sequential runs on this codebase are JIT noise (+/-25% run to run, the
 * Jul-29 finding), so: same page, same warm JIT, same drag, alternating
 * pipeline-on and pipeline-off blocks, paired difference reported. The
 * toggle is __massimo.regionPipeline.enable(): off mid-gesture drains and
 * resumes the synchronous path; on re-arms at the next slow frame report.
 *
 * Two numbers per arm, because the pipeline changes WHAT a frame costs
 * where:
 *   - rAF period during input: main-thread occupancy — the liveness the
 *     pipeline exists for. Sync arm ≈ geometry + render; pipelined arm ≈
 *     the render floor.
 *   - paint advances per second: how often the dragged station's painted
 *     position actually moves — visual throughput (sum -> max of the two
 *     walls). The pipelined arm trails the cursor but must not advance
 *     SLOWER than the sync arm.
 *
 *   npm run build
 *   PORT=5234 npx playwright test -c .perf/playwright.perf-prod.config.ts e2e/perf-pipeline-ab.spec.ts
 */
import { test, type Page } from '@playwright/test';
import { readPerfMap } from '../perfMap';

const TARGETS = (process.env.PERF_TARGETS ?? 'Times Sq,Atlantic-Barclays,Halsey').split(',');
const BLOCKS = Number(process.env.PERF_BLOCKS ?? 6); // alternating A/B block pairs
const BLOCK_MS = Number(process.env.PERF_BLOCK_MS ?? 1500); // per-arm block length

interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number; stops: unknown[] }>;
  [k: string]: unknown;
}

async function seedAt(page: Page, doc: DocShape, c: { x: number; y: number }) {
  await page.goto('/e2e-blank.html');
  await page.evaluate(
    ([k, v, vk, vv]) => {
      localStorage.setItem(k as string, v as string);
      localStorage.setItem(vk as string, vv as string);
    },
    [
      'massimo-doc:perf-map',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-camera:perf-map',
      JSON.stringify({ state: { x: c.x, y: c.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.goto('/#map=perf-map');
  await page.waitForSelector('.canvas-host svg');
  await page.waitForTimeout(1500);
}

test('interleaved A/B: region pipeline on vs off', async ({ page }) => {
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
      async ([sx, sy, sid, blocks, blockMs]) => {
        const svg = document.querySelector('.canvas-host svg')!;
        const massimo = (
          window as unknown as {
            __massimo: {
              regionPipeline: {
                enable: (on: boolean, o?: { armThresholdMs?: number }) => void;
                status: () => { armed: boolean };
              };
            };
          }
        ).__massimo;
        const stationEl = () => document.querySelector(`g[data-station-id="${sid as string}"]`);
        interface Arm {
          rafPeriods: number[];
          paints: number;
          ms: number;
          armedTicks: number;
          ticks: number;
        }
        const mk = (): Arm => ({ rafPeriods: [], paints: 0, ms: 0, armedTicks: 0, ticks: 0 });
        const on = mk();
        const off = mk();
        let step = 0;

        const runBlock = async (pipeline: boolean, sink: Arm) => {
          massimo.regionPipeline.enable(pipeline);
          // Warm-up moves so arming (on-arm) / draining (off-arm) settles
          // outside the measured window.
          for (let i = 0; i < 4; i++) {
            step++;
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
          }
          const t0 = performance.now();
          let last = t0;
          let lastPaint = stationEl()?.getAttribute('transform');
          while (performance.now() - t0 < (blockMs as number)) {
            step++;
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
            const now = performance.now();
            sink.rafPeriods.push(now - last);
            last = now;
            const paint = stationEl()?.getAttribute('transform');
            if (paint !== lastPaint) {
              sink.paints++;
              lastPaint = paint;
            }
            sink.ticks++;
            if (massimo.regionPipeline.status().armed) sink.armedTicks++;
          }
          sink.ms += performance.now() - t0;
        };

        for (let b = 0; b < (blocks as number); b++) {
          if (b % 2 === 0) {
            await runBlock(false, off);
            await runBlock(true, on);
          } else {
            await runBlock(true, on);
            await runBlock(false, off);
          }
        }
        massimo.regionPipeline.enable(false);
        return { on, off };
      },
      [cx, cy, st.id, BLOCKS, BLOCK_MS],
    );
    await page.mouse.up();

    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const fmt = (a: typeof res.on, label: string) =>
      `  ${label}  rAF med=${med(a.rafPeriods).toFixed(1)}ms  ` +
      `paints/s=${((a.paints / a.ms) * 1000).toFixed(1)}  ` +
      `armed=${a.armedTicks}/${a.ticks}`;
    console.log(
      `\n[${st.name.replace(/\n/g, ' ')}] interleaved, ${BLOCKS} block pairs x ${BLOCK_MS}ms\n` +
        fmt(res.off, 'pipeline OFF') +
        '\n' +
        fmt(res.on, 'pipeline ON ') +
        `\n  => main-thread ${(med(res.off.rafPeriods) / med(res.on.rafPeriods)).toFixed(2)}x, ` +
        `visual ${(res.on.paints / res.on.ms / (res.off.paints / res.off.ms)).toFixed(2)}x`,
    );
  }
});
