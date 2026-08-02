/* THROWAWAY browser perf harness — not part of the suite.
 *
 *   PORT=5233 npx playwright test e2e/perf-drag.spec.ts --reporter=line
 *
 * Loads the real MTA map centred on a named station, performs a REAL mouse
 * drag, and measures the frame rate the user actually gets: rAF-to-rAF
 * intervals while the pointer is continuously moving.
 */
import { test, expect, type Page } from '@playwright/test';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';

const TARGETS = (process.env.PERF_TARGETS ?? 'Times Sq,Atlantic-Barclays,Canal,Halsey').split(',');

interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number; stops: unknown[] }>;
  [k: string]: unknown;
}

function loadDoc(): DocShape {
  const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;
  // PERF_NO_REGIONS=1 empties regionAssignments, which turns `needRegions`
  // (MapCanvas.tsx:490-492) off and skips the whole region pipeline. What
  // remains is bands + markers + React + DOM + paint: the render floor.
  if (process.env.PERF_NO_REGIONS) doc.regionAssignments = {};
  // PERF_KEEP=<n>: keep only the n stations nearest the first target, to test
  // whether the render floor scales with the size of the SVG tree.
  const keep = Number(process.env.PERF_KEEP ?? 0);
  if (keep > 0) {
    const target = Object.values(doc.stations).find((s) =>
      s.name.toLowerCase().replace(/\s+/g, ' ').includes(TARGETS[0].toLowerCase().trim()),
    )!;
    const near = Object.values(doc.stations)
      .sort(
        (a, b) =>
          (a.x - target.x) ** 2 + (a.y - target.y) ** 2 - ((b.x - target.x) ** 2 + (b.y - target.y) ** 2),
      )
      .slice(0, keep);
    const ids = new Set(near.map((s) => s.id));
    doc.stations = Object.fromEntries(near.map((s) => [s.id, s]));
    const lines = doc.lines as Record<string, { stations: string[]; edges: string[] }>;
    for (const l of Object.values(lines)) {
      l.stations = l.stations.filter((id) => ids.has(id));
      l.edges = l.edges.filter((e) => e.split('|').every((id) => ids.has(id)));
    }
    doc.transfers = Object.fromEntries(
      Object.entries(doc.transfers as Record<string, { a: { stationId?: string }; b: { stationId?: string } }>)
        .filter(([, t]) => (!t.a.stationId || ids.has(t.a.stationId)) && (!t.b.stationId || ids.has(t.b.stationId))),
    );
  }
  return doc;
}

/** Seed the doc + a camera centred on `centre`, then reload. */
async function seedAt(page: Page, doc: DocShape, centre: { x: number; y: number }): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([key, value, vkey, vp]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(vkey as string, vp as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-viewport',
      JSON.stringify({ state: { x: centre.x, y: centre.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
  // Let the first full build settle before timing anything.
  await page.waitForTimeout(1500);
}

interface Sample {
  name: string;
  stops: number;
  fps: number;
  medFrameMs: number;
  p90FrameMs: number;
  longTasks: number;
  longTaskMs: number;
  renders: number;
}

test.describe('station drag performance', () => {
  test('real-drag frame rate on hub stations', async ({ page }) => {
    test.setTimeout(900_000);
    const doc = loadDoc();
    const out: Sample[] = [];

    for (const frag of TARGETS) {
      const st = Object.values(doc.stations).find((s) =>
        s.name.toLowerCase().replace(/\s+/g, ' ').includes(frag.toLowerCase().trim()),
      );
      if (!st) {
        console.log(`!! no station matching "${frag}"`);
        continue;
      }

      await seedAt(page, doc, { x: st.x, y: st.y });

      const handle = page.locator(`[data-station-id="${st.id}"]`).first();
      const box = await handle.boundingBox();
      if (!box) {
        console.log(`!! ${st.name} has no box after centring; skipping`);
        continue;
      }
      // The camera is centred on this station, so its world anchor maps exactly
      // to the centre of the canvas host. The element's own bbox centre does
      // NOT work: it includes the label, which drags the centroid off a
      // rotated or elongated hub and onto empty canvas.
      const hostBox = await page.locator('.canvas-host').boundingBox();
      if (!hostBox) {
        console.log(`!! no canvas host; skipping`);
        continue;
      }
      // Search outward from that point for one whose topmost element actually
      // belongs to this station — a transfer, line tag or foreign stop dot can
      // sit exactly over a hub's anchor.
      const hit = await page.evaluate(
        ([sid, ox, oy]) => {
          const want = sid as string;
          const at = (x: number, y: number) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest('[data-station-id]')?.getAttribute('data-station-id') ?? null;
          };
          if (at(ox as number, oy as number) === want) return { x: ox, y: oy };
          for (let r = 2; r <= 26; r += 2) {
            for (let a = 0; a < 16; a++) {
              const x = Math.round((ox as number) + r * Math.cos((a * Math.PI) / 8));
              const y = Math.round((oy as number) + r * Math.sin((a * Math.PI) / 8));
              if (at(x, y) === want) return { x, y };
            }
          }
          return null;
        },
        [st.id, Math.round(hostBox.x + hostBox.width / 2), Math.round(hostBox.y + hostBox.height / 2)],
      );
      if (!hit) {
        console.log(`!! ${st.name}: no pointer-reachable point on the station; skipping`);
        continue;
      }
      const cx = hit.x as number;
      const cy = hit.y as number;

      // Arm the instruments BEFORE the gesture.
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__perf = { raf: [] as number[], long: [] as number[], armed: false };
        const p = w.__perf as { raf: number[]; long: number[]; armed: boolean };
        const tick = (t: number) => {
          if (p.armed) p.raf.push(t);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (p.armed) p.long.push(e.duration);
          }).observe({ entryTypes: ['longtask'] });
        } catch {
          /* longtask unsupported */
        }
      });

      const before = await handle.boundingBox();
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 6, cy + 4); // clear the drag threshold
      await page.waitForTimeout(600); // let the first drag frame's cost pass

      // Drive the moves from IN THE PAGE and make the browser complete a full
      // frame for each one (rAF resolves after the commit that move caused).
      // Elapsed / N is then honest per-frame cost, directly comparable to the
      // node geometry harness.
      const res = await page.evaluate(
        async ([sx, sy]) => {
          const p = (
            window as unknown as { __perf: { raf: number[]; long: number[]; armed: boolean } }
          ).__perf;
          p.long.length = 0;
          p.armed = true;
          const host = document.querySelector('.canvas-host svg');
          if (!host) return { per: [] as number[], long: [] as number[] };
          const per: number[] = [];
          const N = 30;
          for (let i = 0; i < N; i++) {
            // A slow monotonic sweep. Small oscillations get erased by the snap
            // engine at a hub (it re-aligns to the same seat), which makes the
            // gesture unverifiable; a steady 2px/move drift is both a realistic
            // reposition and provably a move.
            const x = (sx as number) + 6 + i * 2;
            const y = (sy as number) + 4 + i * 1.5;
            const t0 = performance.now();
            host.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse',
              }),
            );
            // Two rAFs: the first resolves at the next frame boundary, the
            // second guarantees the commit this move caused has been painted.
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            per.push(performance.now() - t0);
          }
          p.armed = false;
          return { per, long: p.long };
        },
        [cx, cy],
      );
      await page.mouse.up();

      // PROBE VALIDATION: if the station did not actually move, the handler
      // bailed and every number above is noise.
      const after = await handle.boundingBox();
      const shifted =
        before && after && (Math.abs(after.x - before.x) > 0.5 || Math.abs(after.y - before.y) > 0.5);
      if (!shifted) {
        console.log(`!! ${st.name}: station never moved — drag did not engage. DISCARDING.`);
        continue;
      }

      const warm = res.per.slice(4);
      if (warm.length < 3) {
        console.log(`!! ${st.name}: too few samples`);
        continue;
      }
      const sorted = [...warm].sort((a, b) => a - b);
      const medMs = sorted[Math.floor(sorted.length / 2)];
      out.push({
        name: st.name.replace(/\n/g, ' '),
        stops: st.stops.length,
        fps: 1000 / medMs,
        medFrameMs: medMs,
        p90FrameMs: sorted[Math.floor(sorted.length * 0.9)],
        longTasks: res.long.length,
        longTaskMs: res.long.reduce((a, b) => a + b, 0) / Math.max(1, res.long.length),
        renders: warm.length,
      });
    }

    console.log(`\n=== browser drag frame rate (${process.env.PERF_LABEL ?? 'dev'} build) ===`);
    for (const r of out) {
      console.log(
        `  ${r.name.padEnd(22)} stops=${String(r.stops).padStart(2)}  ` +
          `${r.fps.toFixed(1).padStart(5)} fps   ` +
          `frame med=${r.medFrameMs.toFixed(1).padStart(6)}ms p90=${r.p90FrameMs.toFixed(1).padStart(6)}ms   ` +
          `longtasks=${String(r.longTasks).padStart(3)} @ ${r.longTaskMs.toFixed(0)}ms avg`,
      );
    }
    expect(out.length).toBeGreaterThan(0);
  });

  test('CONTROL: pan and idle frame rate on the same map', async ({ page }) => {
    test.setTimeout(300_000);
    const doc = loadDoc();
    const st = Object.values(doc.stations).find((s) => s.name.includes('Times Sq'))!;
    await seedAt(page, doc, { x: st.x, y: st.y });

    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__perf = { raf: [] as number[], armed: true };
      const p = w.__perf as { raf: number[]; armed: boolean };
      const tick = (t: number) => {
        if (p.armed) p.raf.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Idle: nothing moving at all — the ceiling this machine can offer.
    await page.waitForTimeout(1000);
    const idle = await page.evaluate(() => {
      const p = (window as unknown as { __perf: { raf: number[] } }).__perf;
      const n = p.raf.length;
      const span = p.raf[n - 1] - p.raf[0];
      p.raf.length = 0;
      return (n - 1) / (span / 1000);
    });

    // Pan: the composited path, which should stay at vsync.
    const cx = 700;
    const cy = 400;
    await page.keyboard.down('Space');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(cx + (i % 20) * 3, cy + (i % 14) * 2);
    const pan = await page.evaluate(() => {
      const p = (window as unknown as { __perf: { raf: number[] } }).__perf;
      const n = p.raf.length;
      if (n < 3) return 0;
      return (n - 1) / ((p.raf[n - 1] - p.raf[0]) / 1000);
    });
    await page.mouse.up();
    await page.keyboard.up('Space');

    console.log(
      `\n=== CONTROL === idle ${idle.toFixed(1)} fps, pan ${pan.toFixed(1)} fps ` +
        `on the same 464-station map. If pan is near vsync and drag is not, ` +
        `the medium is fine and the drag pipeline is the problem.`,
    );
    expect(idle).toBeGreaterThan(30);
  });
});
