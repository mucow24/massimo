/* eslint-disable no-undef -- throwaway node-env perf harness */
/**
 * THROWAWAY perf harness — WHICH clip.ts operation leaks wasm memory?
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts -t 'op leak' \
 *     --disableConsoleIntercept
 *
 * wasmLive.perf.test.ts establishes that the leak is REAL: live allocated
 * bytes climb ~59 KB per frame and stay climbing. This finds the call site.
 *
 * TWO EARLIER ATTEMPTS AT THIS QUESTION WERE WRONG, both for the same reason —
 * they watched heap SIZE:
 *
 *   - wasmAttribution charged 100% to `intersect`. Heap size only moves when
 *     free space runs out, so it always names the biggest allocator whatever
 *     the truth is.
 *   - intersectLeak replayed 16,000 real `intersect` calls, saw heap size not
 *     budge, and "cleared" it. At ~30 bytes leaked per call that is 480 KB —
 *     far below the 1 MB probe resolution, against a heap with 15 MB free.
 *     Underpowered, not clean. `intersect` was never exonerated.
 *
 * So this measures LIVE bytes (heap minus what the allocator can hand back),
 * at 64 KB resolution, over enough calls for a per-call leak of tens of bytes
 * to accumulate into something the probe can actually see. Each operation is
 * replayed on the REAL arguments it receives in the real pipeline.
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

type Ring = { x: number; y: number }[];
type Call = { op: string; args: unknown[] };

const { calls, capturing } = vi.hoisted(() => ({
  calls: [] as Call[],
  capturing: { on: false, perOp: 120 },
}));

// Capture the REAL arguments every clip.ts op receives, deep-copied.
vi.mock('../../src/geometry/clip', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...orig };
  const copy = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(copy)
      : v && typeof v === 'object'
        ? { ...(v as Record<string, unknown>) }
        : v;
  for (const name of Object.keys(orig)) {
    const fn = orig[name];
    if (typeof fn !== 'function') continue;
    if (name === 'loadClipper' || name.startsWith('__') || name === 'clipperHeapBytes') continue;
    out[name] = (...a: unknown[]) => {
      if (capturing.on && calls.filter((c) => c.op === name).length < capturing.perOp) {
        calls.push({ op: name, args: a.map(copy) });
      }
      return (fn as (...x: unknown[]) => unknown)(...a);
    };
  }
  return out;
});

const clip = await import('../../src/geometry/clip');
const { clipperHeapBytes, __clipperNativeInstance } = clip;

const PERF = !!process.env.PERF;
const LONG = 900_000;
const MB = 1024 * 1024;
const KB = 1024;
/** Replays per operation. High enough that tens of bytes per call add up. */
const REPLAYS = Number(process.env.PERF_REPLAYS ?? 300);

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

/** Free space inside the CURRENT heap, at 64 KB resolution. */
function probeFreeBytes(): number {
  const inst = __clipperNativeInstance();
  const malloc = inst?._malloc;
  const free = inst?._free;
  if (!malloc || !free) throw new Error('no _malloc/_free');
  const CHUNK = 64 * KB;
  const heapAtStart = clipperHeapBytes();
  const ptrs: number[] = [];
  let got = 0;
  for (let i = 0; i < 200_000; i++) {
    const p = malloc(CHUNK);
    if (!p) break;
    if (clipperHeapBytes() !== heapAtStart) {
      free(p);
      break;
    }
    ptrs.push(p);
    got += CHUNK;
  }
  for (const p of ptrs) free(p);
  return got;
}

const liveBytes = () => clipperHeapBytes() - probeFreeBytes();

describe('op leak', () => {
  it.runIf(PERF)(
    'attributes LIVE wasm growth to a clip.ts operation',
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
      const move = (dx: number, dy: number) => ({
        ...doc.stations,
        [id]: { ...doc.stations[id], x: doc.stations[id].x + dx, y: doc.stations[id].y + dy },
      });

      capturing.on = true;
      for (let i = 0; i < 8; i++) runFrame(doc, move(i % 4, (i * 2) % 4));
      capturing.on = false;

      const byOp = new Map<string, Call[]>();
      for (const c of calls) {
        const list = byOp.get(c.op) ?? [];
        list.push(c);
        byOp.set(c.op, list);
      }
      expect(byOp.size, 'captured no clip.ts calls').toBeGreaterThan(0);

      // PROBE VALIDATION: the probe must see free space that is definitely
      // there, or every number below is noise.
      const h0 = clipperHeapBytes();
      const f0 = probeFreeBytes();
      console.log(
        `\nPROBE CHECK: heap ${(h0 / MB).toFixed(1)} MB, free ${(f0 / MB).toFixed(1)} MB ` +
          `(${((f0 / h0) * 100).toFixed(0)}%), resolution 64 KB`,
      );
      expect(f0 / h0, 'probe is blind to free space').toBeGreaterThan(0.1);

      const rows: { op: string; nCalls: number; leakedKB: number; perCall: number }[] = [];
      for (const [op, list] of byOp) {
        const fn = (clip as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
        if (typeof fn !== 'function') continue;
        // Settle first: whatever this op needs steady-state, it takes now.
        for (let r = 0; r < 3; r++) for (const c of list) fn(...c.args);
        const before = liveBytes();
        let nCalls = 0;
        for (let r = 0; r < REPLAYS; r++) {
          for (const c of list) {
            fn(...c.args);
            nCalls++;
          }
        }
        const after = liveBytes();
        rows.push({
          op,
          nCalls,
          leakedKB: (after - before) / KB,
          perCall: (after - before) / Math.max(nCalls, 1),
        });
      }

      rows.sort((a, b) => b.leakedKB - a.leakedKB);
      console.log(`\n=== LIVE wasm growth by operation (${REPLAYS} replays of real args) ===`);
      console.log('  operation              calls      live grew    bytes/call');
      for (const r of rows) {
        console.log(
          `  ${r.op.padEnd(20)} ${String(r.nCalls).padStart(8)}  ` +
            `${r.leakedKB.toFixed(0).padStart(9)} KB  ${r.perCall.toFixed(1).padStart(10)}`,
        );
      }
      const leakers = rows.filter((r) => r.perCall > 1);
      console.log(
        leakers.length
          ? `\n  => LEAKING: ${leakers.map((r) => `${r.op} (${r.perCall.toFixed(0)} B/call)`).join(', ')}`
          : '\n  => no operation leaks measurably in isolation; the retention is not\n' +
              '     per-call — look at what the PIPELINE holds across frames.',
      );
    },
    LONG,
  );
});
