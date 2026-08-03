/* eslint-disable no-undef -- throwaway node-env perf harness */
/**
 * THROWAWAY perf harness — WHICH clip.ts call grows the wasm heap?
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts -t 'wasm attribution' \
 *     --disableConsoleIntercept
 *
 * wasmHeap.perf.test.ts establishes THAT the heap climbs (16 -> 100 MB over
 * 1500 constant-size frames on the real map). This says which call does it.
 *
 * An earlier version of this file drove each operation on synthetic 64-vertex
 * blobs and reported a confident, useless "nothing grows, every op flat at
 * 16.0 MB" — 34,000 clipper calls in 692ms, because the input was small enough
 * to fit the allocations the engine already had. That is exactly the failure
 * .perf/README.md warns about. So this drives the REAL frame loop and wraps
 * clip.ts to attribute the heap growth that actually happens.
 *
 * Attribution rule: an emscripten heap grows when some allocation cannot be
 * satisfied, so the growth is charged to the call it happened during. Lumpy by
 * nature — one call eats a whole 16 MB step — but over hundreds of frames the
 * charge concentrates on whatever keeps asking for more.
 *
 * READ THE ANSWER THIS GIVES WITH CARE — IT CANNOT ANSWER THE QUESTION YOU
 * WANT. It charges 100% of the growth to `intersect`, and that is true but
 * misleading twice over:
 *
 * 1. intersectLeak.perf.test.ts replays 16,000 of the real arguments intersect
 *    receives and the heap does not move a byte. It is simply the biggest
 *    allocator, so it holds the bag whenever the allocator has to grow.
 * 2. More importantly, this harness is STRUCTURALLY BLIND to a slow leak. It
 *    samples heap SIZE around each call. A few KB leaked per call, anywhere in
 *    the pipeline, does not move heap size until free space runs out — and the
 *    growth is then charged to whatever call is running at that moment, which
 *    is again the biggest allocator. So "intersect did it" is exactly what this
 *    instrument prints whether or not there is a leak, and wherever it is.
 *
 * Do not conclude "fragmentation" from a clean run here. That conclusion was
 * drawn once from this table and it was not supported. Heap size cannot
 * distinguish a leak from fragmentation; only live allocated bytes can.
 */
import { describe, it, expect, vi } from 'vitest';
import { readPerfMap } from '../perfMap';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import {
  buildBandGeometry,
  buildStopMarkers,
  withLinePriorities,
} from '../../src/geometry/interlining';
import { buildExclusionHolesCached, resolveRegionWinners } from '../../src/geometry/lineRegions';
import { regionsFor } from '../../src/geometry/regionCache';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../src/model/lineStroke';
import { lineWidthOf } from '../../src/model/lineWidth';

// Wrap every clip.ts export and charge wasm-heap growth to the call it
// happened during. vi.mock intercepts the module for EVERY importer, so this
// is the production path, not a re-implementation.
const { stats, resetStats } = vi.hoisted(() => {
  const stats: Record<string, { n: number; grownMB: number; steps: number }> = {};
  const resetStats = () => {
    for (const k of Object.keys(stats)) delete stats[k];
  };
  return { stats, resetStats };
});

vi.mock('../../src/geometry/clip', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const heap = orig.clipperHeapBytes as () => number;
  const out: Record<string, unknown> = { ...orig };
  for (const name of Object.keys(orig)) {
    const fn = orig[name];
    if (typeof fn !== 'function' || name === 'loadClipper' || name === 'clipperHeapBytes') continue;
    out[name] = (...a: unknown[]) => {
      const before = heap();
      const r = (fn as (...x: unknown[]) => unknown)(...a);
      const after = heap();
      const s = (stats[name] ??= { n: 0, grownMB: 0, steps: 0 });
      s.n++;
      if (after > before) {
        s.grownMB += (after - before) / (1024 * 1024);
        s.steps++;
      }
      return r;
    };
  }
  return out;
});

// Imported AFTER the mock so this test sees the wrapped module too.
const { clipperHeapBytes } = await import('../../src/geometry/clip');

const PERF = !!process.env.PERF;
const LONG = 900_000;
const MB = 1024 * 1024;
const FRAMES = Number(process.env.PERF_FRAMES ?? 600);

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

function runFrame(doc: MapDoc, stations: Record<StationId, Station>): number {
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
  return geom.faces.length;
}

const movedBy = (
  s: Record<StationId, Station>,
  id: StationId,
  dx: number,
  dy: number,
): Record<StationId, Station> => ({ ...s, [id]: { ...s[id], x: s[id].x + dx, y: s[id].y + dy } });

function busiestStation(doc: MapDoc): StationId {
  let best = Object.keys(doc.stations)[0];
  let n = -1;
  for (const id of Object.keys(doc.stations)) {
    if (doc.stations[id].stops.length > n) {
      n = doc.stations[id].stops.length;
      best = id;
    }
  }
  return best;
}

describe('wasm attribution', () => {
  it.runIf(PERF)(
    'attributes wasm heap growth to a clip.ts call site on the real map',
    () => {
      const doc = loadDoc();
      const id = busiestStation(doc);

      // Warm up, then forget the warmup's charges.
      for (let i = 0; i < 30; i++) runFrame(doc, movedBy(doc.stations, id, (i % 8) - 4, 0));
      resetStats();
      const start = clipperHeapBytes();

      let faces = 0;
      for (let f = 1; f <= FRAMES; f++) {
        faces = runFrame(doc, movedBy(doc.stations, id, (f % 8) - 4, ((f * 3) % 8) - 4));
      }
      const end = clipperHeapBytes();

      const rows = Object.entries(stats).sort((a, b) => b[1].grownMB - a[1].grownMB);
      console.log(
        `\n=== wasm growth attribution over ${FRAMES} real frames ` +
          `(${(start / MB).toFixed(1)} -> ${(end / MB).toFixed(1)} MB, faces=${faces}) ===`,
      );
      console.log('  clip.ts call            calls     grew MB   growth events');
      for (const [name, s] of rows) {
        console.log(
          `  ${name.padEnd(22)} ${String(s.n).padStart(8)}  ${s.grownMB.toFixed(1).padStart(9)}  ` +
            `${String(s.steps).padStart(8)}`,
        );
      }

      // PROBE VALIDATION: if the mock never intercepted, every count is 0 and
      // the table above is an elaborate way of printing nothing.
      const totalCalls = rows.reduce((a, [, s]) => a + s.n, 0);
      expect(totalCalls, 'clip.ts mock never intercepted — attribution is void').toBeGreaterThan(0);
      const attributed = rows.reduce((a, [, s]) => a + s.grownMB, 0);
      console.log(
        `\n  total attributed: ${attributed.toFixed(1)} MB of ` +
          `${((end - start) / MB).toFixed(1)} MB observed`,
      );
      if (rows.length) {
        const [topName, top] = rows[0];
        console.log(
          `  => ${topName} accounts for ${((top.grownMB / Math.max(attributed, 0.001)) * 100).toFixed(0)}%` +
            ` of the growth, over ${top.steps} growth events in ${top.n} calls.`,
        );
      }
    },
    LONG,
  );
});
