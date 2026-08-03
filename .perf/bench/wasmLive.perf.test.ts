/* eslint-disable no-undef -- throwaway node-env perf harness */
/**
 * THROWAWAY perf harness — is the wasm heap growth a LEAK or a HIGH-WATER MARK?
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts -t 'wasm live' \
 *     --disableConsoleIntercept
 *
 * Heap SIZE cannot answer this, and an earlier conclusion of "fragmentation"
 * was drawn from heap size alone and was not supported by anything. An
 * emscripten heap never shrinks, so its size is a high-water mark either way.
 * The distinguishing quantity is how much of that heap is still LIVE.
 *
 * There is no `mallinfo` in this build, and wrapping the exported `_malloc`
 * would be blind to Clipper's internal C++ allocations (those call malloc
 * directly inside the module, not through the JS export). So this measures
 * live-ness from the outside, by asking the allocator how much it can hand
 * back:
 *
 *   Allocate 1 MB blocks until the heap SIZE grows. Everything obtained before
 *   that point came out of space the allocator already had free. Free it all
 *   again. That total is the reusable free space inside the current heap.
 *
 *     free ~= heap   => almost nothing is live. High-water mark / fragmentation.
 *     free <<  heap  => most of the heap is still allocated. A real leak.
 *
 * PROBE VALIDATION is the first assertion below: on a FRESH heap, before any
 * work, the probe must find most of the heap free. If it cannot see free space
 * that is definitely there, its answer after aging means nothing.
 */
import { describe, it, expect } from 'vitest';
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
import { clipperHeapBytes, __clipperNativeInstance } from '../../src/geometry/clip';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../src/model/lineStroke';
import { lineWidthOf } from '../../src/model/lineWidth';

const PERF = !!process.env.PERF;
const LONG = 900_000;
const MB = 1024 * 1024;
const FRAMES = Number(process.env.PERF_FRAMES ?? 1200);

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

/**
 * Reusable free space inside the CURRENT heap, in bytes: 1 MB blocks taken
 * until the heap has to grow, then all handed back.
 */
function probeFreeBytes(): number {
  const inst = __clipperNativeInstance();
  const malloc = inst?._malloc;
  const free = inst?._free;
  if (!malloc || !free) throw new Error('no _malloc/_free on the native instance');
  const CHUNK = MB;
  const heapAtStart = clipperHeapBytes();
  const ptrs: number[] = [];
  let got = 0;
  // Hard stop well above any heap we expect, so a runaway cannot hang the run.
  for (let i = 0; i < 8192; i++) {
    const p = malloc(CHUNK);
    if (!p) break; // allocator refused outright
    if (clipperHeapBytes() !== heapAtStart) {
      // This block forced the heap to grow, so it did NOT come from existing
      // free space. Give it back and stop.
      free(p);
      break;
    }
    ptrs.push(p);
    got += CHUNK;
  }
  for (const p of ptrs) free(p);
  return got;
}

const movedBy = (
  s: Record<StationId, Station>,
  id: StationId,
  dx: number,
  dy: number,
): Record<StationId, Station> => ({ ...s, [id]: { ...s[id], x: s[id].x + dx, y: s[id].y + dy } });

describe('wasm live', () => {
  it.runIf(PERF)(
    'measures how much of the grown heap is still live',
    () => {
      const doc = loadDoc();
      let id = Object.keys(doc.stations)[0];
      let n = -1;
      for (const k of Object.keys(doc.stations)) {
        if (doc.stations[k].stops.length > n) {
          n = doc.stations[k].stops.length;
          id = k;
        }
      }

      // PROBE VALIDATION. A fresh heap is essentially all free; if the probe
      // cannot find that free space, nothing it says later is worth anything.
      const freshHeap = clipperHeapBytes();
      const freshFree = probeFreeBytes();
      console.log(
        `\nPROBE CHECK (fresh): heap ${(freshHeap / MB).toFixed(1)} MB, ` +
          `probe found ${(freshFree / MB).toFixed(1)} MB free ` +
          `(${((freshFree / freshHeap) * 100).toFixed(0)}%)`,
      );
      expect(
        freshFree / freshHeap,
        'probe cannot see free space in a fresh heap — it is blind, ignore its verdict',
      ).toBeGreaterThan(0.3);

      const samples: { frame: number; heapMB: number; freeMB: number; liveMB: number }[] = [];
      const sampleNow = (frame: number) => {
        const heap = clipperHeapBytes();
        const free = probeFreeBytes();
        samples.push({
          frame,
          heapMB: heap / MB,
          freeMB: free / MB,
          liveMB: (heap - free) / MB,
        });
      };

      sampleNow(0);
      const every = Math.max(1, Math.floor(FRAMES / 6));
      for (let f = 1; f <= FRAMES; f++) {
        runFrame(doc, movedBy(doc.stations, id, (f % 8) - 4, ((f * 3) % 8) - 4));
        if (f % every === 0) sampleNow(f);
      }

      console.log(`\n=== live vs free across ${FRAMES} frames ===`);
      console.log('   frame      heap       free       live (heap - free)');
      for (const s of samples) {
        console.log(
          `  ${String(s.frame).padStart(6)}  ${s.heapMB.toFixed(1).padStart(8)} MB  ` +
            `${s.freeMB.toFixed(1).padStart(8)} MB  ${s.liveMB.toFixed(1).padStart(8)} MB`,
        );
      }

      const first = samples[0];
      const last = samples[samples.length - 1];
      const liveGrowth = last.liveMB - first.liveMB;
      const heapGrowth = last.heapMB - first.heapMB;
      console.log(
        `\n  heap grew ${heapGrowth.toFixed(1)} MB; LIVE grew ${liveGrowth.toFixed(1)} MB ` +
          `(${((liveGrowth / Math.max(heapGrowth, 0.001)) * 100).toFixed(0)}% of it)`,
      );
      console.log(
        liveGrowth > heapGrowth * 0.5
          ? '  => MOST OF THE GROWTH IS STILL LIVE. That is a leak: something is\n' +
              '     holding wasm allocations across frames.'
          : liveGrowth > 5
            ? '  => partly live, partly not. Some retention plus allocator overhead.'
            : '  => the grown heap is almost entirely FREE. Nothing is retained; the\n' +
              '     size is a high-water mark and fragmentation, not a leak.',
      );
    },
    LONG,
  );
});
