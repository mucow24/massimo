/* eslint-disable no-undef -- throwaway node-env perf harness */
/**
 * THROWAWAY perf harness — is `intersect` really leaking, and how much?
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts -t 'intersect leak' \
 *     --disableConsoleIntercept
 *
 * wasmAttribution charges 100% of the wasm heap growth to `intersect`, but
 * "growth happened during this call" is not the same as "this call leaks" —
 * the biggest allocator is also the one most likely to be holding the bag when
 * the allocator has to grow. This isolates it: capture the REAL arguments
 * intersect receives during real frames, then replay those same arguments,
 * over and over, on nothing else.
 *
 * Real arguments matter. An earlier attempt used synthetic 64-vertex blobs and
 * reported every operation perfectly flat, because allocations that small fit
 * in the heap the engine already had.
 *
 * Replaying FIXED input is what separates the two explanations:
 *   - unbounded linear growth on identical repeated input  => a leak
 *   - a few steps that then stop                           => fragmentation /
 *                                                             high-water mark
 */
import { describe, it, expect, vi } from 'vitest';
import { readPerfMap } from '../perfMap';
import { parse } from '../../src/model/serialize';
import type { MapDoc } from '../../src/model/types';
import { runFrame } from '../frame';

type Ring = { x: number; y: number }[];

const { captured, capturing } = vi.hoisted(() => ({
  captured: [] as { a: Ring[]; b: Ring[] }[],
  capturing: { on: false, limit: 400 },
}));

vi.mock('../../src/geometry/clip', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const realIntersect = orig.intersect as (a: Ring[], b: Ring[]) => Ring[];
  return {
    ...orig,
    intersect: (a: Ring[], b: Ring[]) => {
      if (capturing.on && captured.length < capturing.limit) {
        // Deep copy: the pipeline reuses and mutates its ring arrays, so
        // holding references would replay whatever they became later.
        captured.push({
          a: a.map((r) => r.map((p) => ({ x: p.x, y: p.y }))),
          b: b.map((r) => r.map((p) => ({ x: p.x, y: p.y }))),
        });
      }
      return realIntersect(a, b);
    },
  };
});

const { clipperHeapBytes, intersect } = await import('../../src/geometry/clip');

const PERF = !!process.env.PERF;
const LONG = 900_000;
const MB = 1024 * 1024;
const REPLAYS = Number(process.env.PERF_REPLAYS ?? 40);

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

describe('intersect leak', () => {
  it.runIf(PERF)(
    'replays real intersect arguments and reports growth per 1000 calls',
    () => {
      const doc = loadDoc();
      let best = Object.keys(doc.stations)[0];
      let n = -1;
      for (const id of Object.keys(doc.stations)) {
        if (doc.stations[id].stops.length > n) {
          n = doc.stations[id].stops.length;
          best = id;
        }
      }
      const move = (dx: number, dy: number) => ({
        ...doc.stations,
        [best]: { ...doc.stations[best], x: doc.stations[best].x + dx, y: doc.stations[best].y + dy },
      });

      // Capture EARLY arguments.
      capturing.on = true;
      for (let i = 0; i < 6 && captured.length < capturing.limit; i++) runFrame(doc, move(i % 4, 0));
      capturing.on = false;
      const earlyVerts =
        captured.reduce(
          (t, c) => t + c.a.reduce((s, r) => s + r.length, 0) + c.b.reduce((s, r) => s + r.length, 0),
          0,
        ) / captured.length;
      const earlyRings =
        captured.reduce((t, c) => t + c.a.length + c.b.length, 0) / captured.length;

      // Age the pipeline, then capture LATE arguments and compare. If the
      // wasm heap climbs because the OPERATIONS are getting bigger, this is
      // where it shows: same face count, more vertices. If they are the same
      // size, the heap growth is the allocator fragmenting, which is a
      // completely different fix.
      const AGE = Number(process.env.PERF_AGE_FRAMES ?? 800);
      for (let i = 0; i < AGE; i++) runFrame(doc, move((i % 8) - 4, ((i * 3) % 8) - 4));
      const heapAfterAging = clipperHeapBytes();
      captured.length = 0;
      capturing.on = true;
      for (let i = 0; i < 6 && captured.length < capturing.limit; i++) runFrame(doc, move(i % 4, 0));
      capturing.on = false;
      const lateVerts =
        captured.reduce(
          (t, c) => t + c.a.reduce((s, r) => s + r.length, 0) + c.b.reduce((s, r) => s + r.length, 0),
          0,
        ) / captured.length;
      const lateRings = captured.reduce((t, c) => t + c.a.length + c.b.length, 0) / captured.length;

      console.log(
        `
=== argument SIZE, fresh vs after ${AGE} frames (heap now ${(heapAfterAging / MB).toFixed(1)} MB) ===`,
      );
      console.log(`  early: ${earlyVerts.toFixed(0)} vertices, ${earlyRings.toFixed(1)} rings per call`);
      console.log(`  late : ${lateVerts.toFixed(0)} vertices, ${lateRings.toFixed(1)} rings per call`);
      console.log(
        lateVerts > earlyVerts * 1.2
          ? '  => the OPERATIONS are growing. Something is accumulating vertices.'
          : '  => operations are the same size. The heap growth is the ALLOCATOR, not the workload.',
      );

      // PROBE VALIDATION: no captured input, nothing to replay, no conclusion.
      expect(captured.length, 'captured no intersect arguments').toBeGreaterThan(0);
      const verts = captured.reduce(
        (t, c) => t + c.a.reduce((s, r) => s + r.length, 0) + c.b.reduce((s, r) => s + r.length, 0),
        0,
      );
      console.log(
        `\ncaptured ${captured.length} real intersect argument pairs ` +
          `(${verts} vertices total, ${(verts / captured.length).toFixed(0)} avg per call)`,
      );

      // Settle any high-water mark from the capture frames.
      for (const c of captured) intersect(c.a, c.b);
      for (const c of captured) intersect(c.a, c.b);

      const start = clipperHeapBytes();
      const marks: { calls: number; mb: number }[] = [];
      let calls = 0;
      for (let r = 0; r < REPLAYS; r++) {
        for (const c of captured) {
          intersect(c.a, c.b);
          calls++;
        }
        if (r % Math.max(1, Math.floor(REPLAYS / 8)) === 0 || r === REPLAYS - 1) {
          marks.push({ calls, mb: clipperHeapBytes() / MB });
        }
      }
      const end = clipperHeapBytes();

      console.log(`\n=== replaying the SAME ${captured.length} intersect calls, ${REPLAYS}x ===`);
      for (const m of marks) {
        console.log(`  after ${String(m.calls).padStart(7)} calls   ${m.mb.toFixed(1).padStart(7)} MB`);
      }
      const grownMB = (end - start) / MB;
      console.log(
        `\n  ${(start / MB).toFixed(1)} -> ${(end / MB).toFixed(1)} MB over ${calls} calls\n` +
          `  ${((grownMB / calls) * 1000).toFixed(2)} MB per 1000 intersect calls`,
      );

      // Growth confined to the first half would be a high-water mark; growth
      // that continues at the same rate on identical input is a leak.
      const half = marks[Math.floor(marks.length / 2)];
      const firstHalf = half.mb - marks[0].mb;
      const secondHalf = marks[marks.length - 1].mb - half.mb;
      console.log(
        `  first half +${firstHalf.toFixed(1)} MB, second half +${secondHalf.toFixed(1)} MB`,
      );
      console.log(
        secondHalf > 1
          ? '  => still climbing on IDENTICAL input. That is a leak.'
          : '  => settled. Fragmentation / high-water mark, not a leak.',
      );
    },
    LONG,
  );
});
