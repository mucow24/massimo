/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * Attributes every clipper call to its SOURCE LINE via stack capture, so the
 * per-frame clipper bill can be split by call site rather than by op name.
 *
 *   PERF=1 npx vitest run src/perf/clipAttribution.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect, vi } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildExclusionHolesCached, resolveRegionWinners } from '../../src/geometry/lineRegions';
import { regionsFor } from '../../src/geometry/regionCache';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../src/model/lineStroke';
import { lineWidthOf } from '../../src/model/lineWidth';

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

vi.mock('../geometry/clip', async (importOriginal) => {
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

function runFrame(doc: MapDoc, stations: Record<StationId, Station>): void {
  const g = { stations, lines: doc.lines, lineCircles: doc.lineCircles };
  const bandsGeometry = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const bands = withLinePriorities(bandsGeometry, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, bands, doc.lineCircles);
  const geom = regionsFor(g, { bands: bandsGeometry, markers }, { transient: true });
  const winners = resolveRegionWinners(geom.faces, doc.regionAssignments, geom.bands, doc.lineOrder);
  buildExclusionHolesCached(
    geom.faces,
    winners,
    doc.lineOrder,
    geom.bands,
    geom.markers,
    (lineId) => {
      const line = doc.lines[lineId];
      return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
    },
    geom.slivers,
    geom.holeChain,
  );
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
        let tot = 0;
        for (const [, c] of rows) tot += c.ms;
        for (const [k, c] of rows.slice(0, 14)) {
          console.log(
            `  ${k.padEnd(42)} ${String(Math.round(c.n / FRAMES)).padStart(6)}/f  ` +
              `${(c.ms / FRAMES).toFixed(2).padStart(7)}ms/f  (${((c.ms / wall) * 100).toFixed(0)}%)  ` +
              `${Math.round(c.verts / c.n)} verts/call`,
          );
        }
        console.log(
          `  --- clip total ${(tot / FRAMES).toFixed(1)}ms/f (${((tot / wall) * 100).toFixed(0)}%)`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );
});
