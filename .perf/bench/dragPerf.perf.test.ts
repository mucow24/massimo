/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * THROWAWAY perf harness — per-frame station-drag geometry cost on a real map.
 * Gated behind PERF=1 so it never runs in the suite.
 *
 * Run:
 *   PERF=1 npx vitest run src/perf/dragPerf.perf.test.ts --disableConsoleIntercept
 * Map: PERF_MAP=<path>, else the first .massimo.json in .perf/ (see perfMap.ts)
 * Station filter: PERF_ONLY=<name fragment>
 *
 * Mirrors MapCanvas's memo chain exactly (MapCanvas.tsx:388-546):
 *   bandsGeometry -> bands(withLinePriorities) -> stopMarkers -> renderables
 *   -> regionGeom(regionsFor, transient) -> regionWinners -> regionExcludeHoles
 */
import { describe, it, expect, vi } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildExclusionHolesCached, resolveRegionWinners } from '../../src/geometry/lineRegions';
import { regionsFor, regionGeometrySig } from '../../src/geometry/regionCache';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../src/model/lineStroke';
import { lineWidthOf } from '../../src/model/lineWidth';

// ---- clipper instrumentation ---------------------------------------------
// vi.mock intercepts clip.ts for EVERY importer, so op counts/timings are the
// production path's, not a re-implementation's.
const { opStats, resetOps, timed } = vi.hoisted(() => {
  const opStats: Record<string, { n: number; ms: number }> = {};
  const resetOps = () => {
    for (const k of Object.keys(opStats)) delete opStats[k];
  };
  const timed =
    (name: string, fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) => {
      const t = performance.now();
      const r = fn(...a);
      const s = (opStats[name] ??= { n: 0, ms: 0 });
      s.n++;
      s.ms += performance.now() - t;
      return r;
    };
  return { opStats, resetOps, timed };
});

vi.mock('../geometry/clip', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...orig };
  for (const name of Object.keys(orig)) {
    if (typeof orig[name] === 'function' && name !== 'loadClipper') {
      out[name] = timed(`clip.${name}`, orig[name] as (...a: unknown[]) => unknown);
    }
  }
  return out;
});

const PERF = !!process.env.PERF;
const ONLY = process.env.PERF_ONLY;
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

interface FrameCost {
  sig: number;
  bands: number;
  priorities: number;
  markers: number;
  regions: number;
  winners: number;
  holes: number;
  total: number;
  faces: number;
  nbands: number;
  nmarkers: number;
}

/** One pointermove's worth of MapCanvas memo work. */
function runFrame(
  doc: MapDoc,
  stations: Record<StationId, Station>,
  opts: { transient: boolean },
): FrameCost {
  const g = { stations, lines: doc.lines, lineCircles: doc.lineCircles };

  // MapCanvas recomputes stationsGeometrySig on every stations identity change
  // (MapCanvas.tsx:364) and it gates bandsGeometry. Charged separately because
  // the transient flag only skips regionCache's copy, not this one.
  const t0 = performance.now();
  const sig = regionGeometrySig(g);
  void sig;
  const t1 = performance.now();
  const bandsGeometry = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const t2 = performance.now();
  const bands = withLinePriorities(bandsGeometry, doc.lines, doc.lineOrder);
  const t3 = performance.now();
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, bands, doc.lineCircles);
  const t4 = performance.now();
  const geom = regionsFor(g, { bands: bandsGeometry, markers }, { transient: opts.transient });
  const t5 = performance.now();
  const winners = resolveRegionWinners(geom.faces, doc.regionAssignments, geom.bands, doc.lineOrder);
  const t6 = performance.now();
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
  const t7 = performance.now();

  return {
    sig: t1 - t0,
    bands: t2 - t1,
    priorities: t3 - t2,
    markers: t4 - t3,
    regions: t5 - t4,
    winners: t6 - t5,
    holes: t7 - t6,
    total: t7 - t0,
    faces: geom.faces.length,
    nbands: bands.length,
    nmarkers: markers.length,
  };
}

function moved(
  stations: Record<StationId, Station>,
  id: StationId,
  dx: number,
  dy: number,
): Record<StationId, Station> {
  const st = stations[id];
  return { ...stations, [id]: { ...st, x: st.x + dx, y: st.y + dy } };
}

const fmt = (v: number) => v.toFixed(1).padStart(7);
function stats(vals: number[]): string {
  const s = [...vals].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `med=${fmt(at(0.5))} p90=${fmt(at(0.9))} max=${fmt(s[s.length - 1])}`;
}
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

function pickTargets(doc: MapDoc): Station[] {
  const all = Object.values(doc.stations);
  const byName = (frag: string) =>
    all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(frag.toLowerCase()));
  if (ONLY) {
    const s = byName(ONLY);
    if (!s) throw new Error(`no station matching ${ONLY}`);
    return [s];
  }
  const hubs = ['Times Sq', 'Atlantic', 'Canal', 'Union Sq']
    .map(byName)
    .filter((s): s is Station => !!s);
  const sorted = [...all].filter((s) => s.stops.length > 0).sort((a, b) => a.stops.length - b.stops.length);
  const median = sorted[Math.floor(sorted.length / 2)];
  return [...hubs, median];
}

describe.runIf(PERF)('station drag perf', () => {
  // PROBE VALIDATION. If the incremental chain is live, a frame that moves
  // NOTHING must collapse to near-zero: every unit hash matches, no component
  // rebuilds, every hole entry reuses. If a no-op frame costs the same as a
  // drag frame, the harness is doing a cold build every time and every other
  // number in this file is a lie.
  it(
    'CONTROL: no-op frame must be far cheaper than a drag frame',
    async () => {
      const doc = loadDoc();
      runFrame(doc, doc.stations, { transient: true });
      const noop: number[] = [];
      for (let f = 0; f < 10; f++) noop.push(runFrame(doc, doc.stations, { transient: true }).total);

      const target = pickTargets(doc)[0];
      let stations = doc.stations;
      const drag: number[] = [];
      for (let f = 0; f < 10; f++) {
        stations = moved(stations, target.id, 1.5, 1.0);
        drag.push(runFrame(doc, stations, { transient: true }).total);
      }
      const noopMed = med(noop);
      const dragMed = med(drag);
      console.log(
        `\n=== CONTROL === no-op frame med=${noopMed.toFixed(1)}ms, ` +
          `drag frame med=${dragMed.toFixed(1)}ms, ratio=${(dragMed / noopMed).toFixed(1)}x`,
      );
      // The chain is live only if standing still is dramatically cheaper.
      expect(noopMed).toBeLessThan(dragMed * 0.5);
    },
    LONG,
  );

  it(
    'per-frame drag cost by station',
    async () => {
      const doc = loadDoc();
      console.log(
        `\nmap: ${doc.name} — ${Object.keys(doc.stations).length} stations, ` +
          `${Object.keys(doc.lines).length} lines, ` +
          `${Object.keys(doc.regionAssignments).length} assignments`,
      );

      {
        const t0 = performance.now();
        const c = runFrame(doc, doc.stations, { transient: false });
        const t1 = performance.now();
        console.log(
          `cold full build: ${(t1 - t0).toFixed(1)}ms — ${c.faces} faces, ` +
            `${c.nbands} bands, ${c.nmarkers} markers`,
        );
      }

      const FRAMES = 24;
      for (const target of pickTargets(doc)) {
        // Warm: one frame at rest so the incremental state is seeded.
        runFrame(doc, doc.stations, { transient: true });
        const costs: FrameCost[] = [];
        let stations = doc.stations;
        for (let f = 0; f < FRAMES; f++) {
          const dir = f < FRAMES / 2 ? 1 : -1;
          stations = moved(stations, target.id, 1.5 * dir, 1.0 * dir);
          costs.push(runFrame(doc, stations, { transient: true }));
        }
        const pick = (k: keyof FrameCost) => costs.map((c) => c[k] as number);
        console.log(
          `\n[${target.name.replace(/\n/g, ' ')}] stops=${target.stops.length}\n` +
            `  TOTAL      ${stats(pick('total'))}\n` +
            `  sig        ${stats(pick('sig'))}\n` +
            `  bands      ${stats(pick('bands'))}\n` +
            `  priorities ${stats(pick('priorities'))}\n` +
            `  markers    ${stats(pick('markers'))}\n` +
            `  regions    ${stats(pick('regions'))}\n` +
            `  winners    ${stats(pick('winners'))}\n` +
            `  holes      ${stats(pick('holes'))}`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );

  it(
    'clipper op attribution per target',
    async () => {
      const doc = loadDoc();
      for (const target of pickTargets(doc)) {
        runFrame(doc, doc.stations, { transient: true });
        resetOps();
        let stations = doc.stations;
        const FRAMES = 10;
        const t0 = performance.now();
        for (let f = 0; f < FRAMES; f++) {
          stations = moved(stations, target.id, 1.5, 1.0);
          runFrame(doc, stations, { transient: true });
        }
        const wall = performance.now() - t0;
        console.log(
          `\n[${target.name.replace(/\n/g, ' ')}] ${FRAMES} frames, ` +
            `wall=${wall.toFixed(1)}ms (${(wall / FRAMES).toFixed(1)}ms/frame)`,
        );
        const rows = Object.entries(opStats).sort((a, b) => b[1].ms - a[1].ms);
        let clipTotal = 0;
        for (const [, c] of rows) clipTotal += c.ms;
        for (const [name, c] of rows.slice(0, 8)) {
          console.log(
            `  ${name.padEnd(24)} ${String(Math.round(c.n / FRAMES)).padStart(6)}/f  ` +
              `${c.ms.toFixed(1).padStart(8)}ms  (${((c.ms / wall) * 100).toFixed(0)}%)`,
          );
        }
        console.log(
          `  clip total ${clipTotal.toFixed(1)}ms (${((clipTotal / wall) * 100).toFixed(0)}%), ` +
            `JS other ${(wall - clipTotal).toFixed(1)}ms ` +
            `(${(((wall - clipTotal) / wall) * 100).toFixed(0)}%)`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );

  it(
    'phase share table',
    async () => {
      const doc = loadDoc();
      const rows: string[] = [];
      for (const target of pickTargets(doc)) {
        runFrame(doc, doc.stations, { transient: true });
        let stations = doc.stations;
        const costs: FrameCost[] = [];
        for (let f = 0; f < 16; f++) {
          stations = moved(stations, target.id, 1.5, 1.0);
          costs.push(runFrame(doc, stations, { transient: true }));
        }
        const keys: (keyof FrameCost)[] = [
          'sig',
          'bands',
          'priorities',
          'markers',
          'regions',
          'winners',
          'holes',
        ];
        const totals = sum(costs.map((c) => c.total));
        const parts = keys
          .map((k) => `${k}=${((sum(costs.map((c) => c[k] as number)) / totals) * 100).toFixed(0)}%`)
          .join(' ');
        rows.push(
          `${target.name.replace(/\n/g, ' ').padEnd(24)} ` +
            `med=${med(costs.map((c) => c.total)).toFixed(1).padStart(7)}ms  ${parts}`,
        );
      }
      console.log('\n=== phase shares ===\n' + rows.join('\n'));
      expect(true).toBe(true);
    },
    LONG,
  );
});
