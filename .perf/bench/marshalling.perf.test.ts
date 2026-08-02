/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * How much of "clipper time" is the WASM boolean, and how much is the JS
 * object marshalling around it?
 *
 * clip.ts converts every Ring (Vec2 objects) to IntPoint objects on the way in
 * (`toInt`) and back on the way out (`fromInt`) — one allocation per vertex,
 * each way, on every call. This measures the split on the real per-frame
 * workload.
 *
 *   PERF=1 npx vitest run src/perf/marshalling.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { MapDoc, StationId, Station } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildLineBodies, ringsBbox, boxesOverlap } from '../../src/geometry/lineRegions';
import { CLIP_SCALE, type Ring } from '../../src/geometry/clip';
import { loadNativeClipperLibInstanceAsync, NativeClipperLibRequestedFormat } from 'js-angusj-clipper';

const PERF = !!process.env.PERF;
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

function geomFor(doc: MapDoc, stations: Record<StationId, Station>) {
  const bands = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const withPri = withLinePriorities(bands, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, withPri, doc.lineCircles);
  return { bands, markers };
}

describe.runIf(PERF)('clipper marshalling split', () => {
  it(
    'toInt / clipToPaths / fromInt breakdown on the real pair workload',
    async () => {
      const lib = await loadNativeClipperLibInstanceAsync(
        NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
      );
      console.log(`\nengine format: ${lib.format}`);

      const doc = loadDoc();
      const { bands, markers } = geomFor(doc, doc.stations);
      const bodies = buildLineBodies(bands, markers);
      const ids = [...bodies.keys()].sort();
      const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));

      // The exact workload buildZoneCached runs: every bbox-surviving pair.
      const work: [Ring[], Ring[]][] = [];
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          if (boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!))
            work.push([bodies.get(ids[i])!, bodies.get(ids[j])!]);

      const toInt = (ring: Ring) =>
        ring.map((p) => ({ x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) }));
      const fromInt = (path: readonly { x: number; y: number }[]): Ring =>
        path.map((p) => ({ x: p.x / CLIP_SCALE, y: p.y / CLIP_SCALE }));

      const REPS = 3;
      let msToInt = 0;
      let msClip = 0;
      let msFromInt = 0;
      let inVerts = 0;
      let outVerts = 0;

      for (let r = 0; r < REPS; r++) {
        for (const [a, b] of work) {
          const t0 = performance.now();
          const sa = a.map(toInt);
          const sb = b.map(toInt);
          const t1 = performance.now();
          const sol = lib.clipToPaths({
            clipType: 'intersection' as never,
            subjectInputs: [{ data: sa, closed: true }],
            clipInputs: [{ data: sb }],
            subjectFillType: 'nonZero' as never,
            clipFillType: 'nonZero' as never,
          });
          const t2 = performance.now();
          const out = (sol ?? []).map(fromInt);
          const t3 = performance.now();
          msToInt += t1 - t0;
          msClip += t2 - t1;
          msFromInt += t3 - t2;
          if (r === 0) {
            for (const ring of a) inVerts += ring.length;
            for (const ring of b) inVerts += ring.length;
            for (const ring of out) outVerts += ring.length;
          }
        }
      }
      const tot = msToInt + msClip + msFromInt;
      console.log(
        `${work.length} whole-body pair intersects x${REPS}\n` +
          `  toInt        ${(msToInt / REPS).toFixed(1)}ms/pass  (${((msToInt / tot) * 100).toFixed(0)}%)\n` +
          `  clipToPaths  ${(msClip / REPS).toFixed(1)}ms/pass  (${((msClip / tot) * 100).toFixed(0)}%)\n` +
          `  fromInt      ${(msFromInt / REPS).toFixed(1)}ms/pass  (${((msFromInt / tot) * 100).toFixed(0)}%)\n` +
          `  input verts ${inVerts}, output verts ${outVerts}`,
      );

      // Would caching the integer form help? Measure a pass where the subject
      // is converted once and reused (what a persistent int cache would give).
      const preA = work.map(([a]) => a.map(toInt));
      const preB = work.map(([, b]) => b.map(toInt));
      let msCached = 0;
      for (let r = 0; r < REPS; r++) {
        const t0 = performance.now();
        for (let i = 0; i < work.length; i++) {
          const sol = lib.clipToPaths({
            clipType: 'intersection' as never,
            subjectInputs: [{ data: preA[i], closed: true }],
            clipInputs: [{ data: preB[i] }],
            subjectFillType: 'nonZero' as never,
            clipFillType: 'nonZero' as never,
          });
          void (sol ?? []).map(fromInt);
        }
        msCached += performance.now() - t0;
      }
      console.log(
        `  with input ints CACHED: ${(msCached / REPS).toFixed(1)}ms/pass ` +
          `vs ${(tot / REPS).toFixed(1)}ms uncached -> ` +
          `${(tot / msCached).toFixed(2)}x from caching the integer conversion alone`,
      );
      expect(true).toBe(true);
    },
    LONG,
  );
});
