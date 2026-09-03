/* THROWAWAY: CDP CPU profile of a station drag, bucketed by function+file. */
import { test, expect } from '@playwright/test';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';

const TARGET = process.env.PERF_TARGET ?? 'Times Sq';

test('cpu profile of a station drag', async ({ page }) => {
  test.setTimeout(600_000);
  const doc = (
    JSON.parse(readPerfMap()) as {
      doc: {
        stations: Record<string, { id: string; name: string; x: number; y: number }>;
        regionAssignments: Record<string, unknown>;
      };
    }
  ).doc;
  if (process.env.PERF_NO_REGIONS) doc.regionAssignments = {};
  const st = Object.values(doc.stations).find((s) =>
    s.name.toLowerCase().replace(/\s+/g, ' ').includes(TARGET.toLowerCase()),
  )!;

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
      JSON.stringify({ state: { x: st.x, y: st.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.goto('/#map=perf-map');
  await page.waitForSelector('.canvas-host svg');
  await page.waitForTimeout(2000);

  const host = (await page.locator('.canvas-host').boundingBox())!;
  const hit = await page.evaluate(
    ([sid, ox, oy]) => {
      const at = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest('[data-station-id]')?.getAttribute('data-station-id') ??
        null;
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
  if (!hit) throw new Error('no hit point');
  const cx = hit.x as number;
  const cy = hit.y as number;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 6, cy + 4);
  await page.waitForTimeout(500);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');

  await page.evaluate(
    async ([sx, sy]) => {
      const hostEl = document.querySelector('.canvas-host svg')!;
      for (let i = 0; i < 24; i++) {
        hostEl.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            clientX: (sx as number) + 6 + i * 2,
            clientY: (sy as number) + 4 + i * 1.5,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    },
    [cx, cy],
  );

  const { profile } = await cdp.send('Profiler.stop');
  await page.mouse.up();

  // Self time per node, bucketed by "file :: function".
  const byNode = new Map<number, { key: string; self: number }>();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    const url = (f.url || '').split('/').slice(-1)[0].split('?')[0] || '(native)';
    const name = f.functionName || '(anonymous)';
    byNode.set(n.id, { key: `${url} :: ${name}`, self: 0 });
  }
  const totalMs = (profile.endTime - profile.startTime) / 1000;
  const deltas = profile.timeDeltas ?? [];
  const samples = profile.samples ?? [];
  for (let i = 0; i < samples.length; i++) {
    const e = byNode.get(samples[i]);
    if (e) e.self += (deltas[i] ?? 0) / 1000;
  }
  const agg = new Map<string, number>();
  for (const { key, self } of byNode.values()) agg.set(key, (agg.get(key) ?? 0) + self);

  const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);
  const label = process.env.PERF_NO_REGIONS ? 'NO REGIONS' : 'full';
  console.log(`\n=== CPU profile [${TARGET}, ${label}] over ${totalMs.toFixed(0)}ms wall ===`);
  for (const [k, ms] of rows.slice(0, 34)) {
    if (ms < totalMs * 0.004) break;
    console.log(`  ${((ms / totalMs) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(6)}ms  ${k}`);
  }

  // Also aggregate by FILE, which is the actionable unit.
  const byFile = new Map<string, number>();
  for (const [k, ms] of agg) byFile.set(k.split(' :: ')[0], (byFile.get(k.split(' :: ')[0]) ?? 0) + ms);
  console.log(`\n--- by file ---`);
  for (const [k, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    console.log(`  ${((ms / totalMs) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(6)}ms  ${k}`);
  }
  expect(true).toBe(true);
});
