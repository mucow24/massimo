/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * Attributes every clipper call to its SOURCE LINE via stack capture, so the
 * per-frame clipper bill can be split by call site rather than by op name.
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts .perf/bench/clipAttribution.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect, vi } from 'vitest';
import { readPerfMap } from '../perfMap';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { runFrame } from '../frame';

const { siteStats, resetSites, armed, timedSite } = vi.hoisted(() => {
  const siteStats: Record<string, { n: number; ms: number; verts: number }> = {};
  const resetSites = () => {
    for (const k of Object.keys(siteStats)) delete siteStats[k];
  };
  const armed = { on: false };
  // Walk out of clip.ts to the first frame in geometry/ that is not clip.ts.
  const siteOf = (): string => {
    const st = new Error().stack ?? '';
    const lines = st.split('\n');
    for (let i = 2; i < lines.length; i++) {
      const m = lines[i].match(/[\\/]src[\\/](geometry|model|components)[\\/]([\w.]+):(\d+):/);
      if (m && m[2] !== 'clip.ts') return `${m[2]}:${m[3]}`;
    }
    return 'unknown';
  };
  const countVerts = (a: unknown): number => {
    if (!Array.isArray(a)) return 0;
    let n = 0;
    for (const r of a) if (Array.isArray(r)) n += r.length;
    return n;
  };
  const timedSite =
    (name: string, fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) => {
      if (!armed.on) return fn(...a);
      const key = `${name} @ ${siteOf()}`;
      const t = performance.now();
      const r = fn(...a);
      const s = (siteStats[key] ??= { n: 0, ms: 0, verts: 0 });
      s.n++;
      s.ms += performance.now() - t;
      s.verts += countVerts(a[0]) + countVerts(a[1]);
      return r;
    };
  return { siteStats, resetSites, armed, timedSite };
});

// The specifier is resolved relative to THIS file, so it must carry the same
// `../../src/` prefix as the real imports above — `../geometry/clip` resolves to
// nothing, and vitest no-ops an unresolvable mock silently rather than throwing.
vi.mock('../../src/geometry/clip', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...orig };
  for (const name of Object.keys(orig)) {
    if (typeof orig[name] === 'function' && name !== 'loadClipper') {
      out[name] = timedSite(name, orig[name] as (...a: unknown[]) => unknown);
    }
  }
  return out;
});

const PERF = !!process.env.PERF;
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

const moved = (s: Record<StationId, Station>, id: StationId, dx: number, dy: number) => ({
  ...s,
  [id]: { ...s[id], x: s[id].x + dx, y: s[id].y + dy },
});

describe.runIf(PERF)('clip attribution', () => {
  it(
    'per-call-site clipper bill',
    async () => {
      const doc = loadDoc();
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;
      const targets = [find('Times Sq'), find('Atlantic'), find('Halsey')];

      for (const target of targets) {
        runFrame(doc, doc.stations);
        runFrame(doc, doc.stations);
        resetSites();
        armed.on = true;
        let stations = doc.stations;
        const FRAMES = 8;
        const t0 = performance.now();
        for (let f = 0; f < FRAMES; f++) {
          stations = moved(stations, target.id, 1.5, 1.0);
          runFrame(doc, stations);
        }
        const wall = performance.now() - t0;
        armed.on = false;

        console.log(
          `\n### ${target.name.replace(/\n/g, ' ')} (${target.stops.length} stops) — ` +
            `${(wall / FRAMES).toFixed(1)}ms/frame (instrumented)`,
        );
        const rows = Object.entries(siteStats).sort((a, b) => b[1].ms - a[1].ms);
        // PROBE VALIDATION: an inert mock leaves every counter at zero, and the
        // per-call-site table below then bills the clipper at 0% of the frame —
        // the exact inverse of the finding — while still passing green.
        const totalCalls = rows.reduce((a, [, c]) => a + c.n, 0);
        expect(totalCalls, 'clip.ts mock never intercepted — attribution is void').toBeGreaterThan(
          0,
        );
        let tot = 0;
        for (const [, c] of rows) tot += c.ms;
        for (const [k, c] of rows.slice(0, 14)) {
          console.log(
            `  ${k.padEnd(42)} ${String(Math.round(c.n / FRAMES)).padStart(6)}/f  ` +
              `${(c.ms / FRAMES).toFixed(2).padStart(7)}ms/f  (${((c.ms / wall) * 100).toFixed(0)}%)  ` +
              `${Math.round(c.verts / c.n)} verts/call`,
          );
        }
        // The % column is share of the INSTRUMENTED frame, and per-call-site
        // timing costs roughly 10x the frame it measures (571ms/f here vs
        // ~59ms real), so it understates badly — read the ms/f and calls/f
        // columns, and take the clipper's true frame share from
        // dragPerf.perf.test.ts's coarser whole-module attribution.
        console.log(
          `  --- clip total ${(tot / FRAMES).toFixed(1)}ms/f ` +
            `(${((tot / wall) * 100).toFixed(0)}% of the INSTRUMENTED frame — see note above)`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );
});
