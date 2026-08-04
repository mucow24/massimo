/* eslint-disable no-undef -- throwaway node-env perf harness */
/**
 * THROWAWAY perf harness — does the CLIPPER'S WASM HEAP grow without bound as
 * a session is edited? Gated behind PERF=1 so it never runs in the suite.
 *
 * Run:
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts -t 'wasm heap' \
 *     --disableConsoleIntercept
 *
 * WHY THIS EXISTS. The browser aging harness (e2e/perf-aging.spec.ts) found
 * exactly one quantity that grew across a thousand station drags: the wasm
 * heap, 16 MB -> 83 MB, while DOM nodes, listeners and the JS heap stayed
 * flat. The browser harness has 25%+ variance and a lot of moving parts; this
 * one drives the same geometry with no browser, no pointer events and no
 * overlays, so the number is trustworthy.
 *
 * THE QUESTION IS NOT "does it grow". An emscripten heap NEVER shrinks, so it
 * is expected to rise to whatever the biggest operation needed and stay there.
 * That is a high-water mark, not a leak, and it is harmless. A leak looks
 * different: it keeps climbing while the work per frame stays the same size.
 * So this runs a long stretch of IDENTICALLY-SIZED frames and asks whether the
 * heap is still rising after the high-water mark should long since have been
 * reached.
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { clipperHeapBytes } from '../../src/geometry/clip';
import { runFrame } from '../frame';

const PERF = !!process.env.PERF;
const LONG = 900_000;
const MB = 1024 * 1024;
const FRAMES = Number(process.env.PERF_FRAMES ?? 1500);
const SAMPLE_EVERY = Number(process.env.PERF_SAMPLE ?? 100);

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

const movedBy = (
  stations: Record<StationId, Station>,
  id: StationId,
  dx: number,
  dy: number,
): Record<StationId, Station> => ({
  ...stations,
  [id]: { ...stations[id], x: stations[id].x + dx, y: stations[id].y + dy },
});

/** The busiest station: the one whose move touches the most geometry. */
function busiestStation(doc: MapDoc): StationId {
  let best: StationId = Object.keys(doc.stations)[0];
  let bestStops = -1;
  for (const id of Object.keys(doc.stations)) {
    const n = doc.stations[id].stops.length;
    if (n > bestStops) {
      bestStops = n;
      best = id;
    }
  }
  return best;
}

describe('wasm heap growth over a long edit session', () => {
  it.runIf(PERF)(
    'reports whether the clipper heap keeps climbing at constant frame size',
    () => {
      const doc = loadDoc();
      const id = busiestStation(doc);
      console.log(
        `\nmap: ${Object.keys(doc.stations).length} stations, ` +
          `${Object.keys(doc.lines).length} lines; dragging "${doc.stations[id].name}" ` +
          `(${doc.stations[id].stops.length} stops)`,
      );

      // PROBE VALIDATION 1: the number has to be real before any trend in it
      // means anything.
      const at0 = clipperHeapBytes();
      expect(at0, 'clipperHeapBytes() reads 0 — the engine is not loaded').toBeGreaterThan(0);

      // Warm up: let the first full build and every lazy path settle, so the
      // high-water mark from STARTUP is already paid before sampling starts.
      let stations = doc.stations;
      for (let i = 0; i < 40; i++) {
        stations = movedBy(doc.stations, id, (i % 8) - 4, ((i * 3) % 8) - 4);
        runFrame(doc, stations);
      }
      const afterWarmup = clipperHeapBytes();

      // PROBE VALIDATION 2: the frames must all be the same SIZE of work, or a
      // rising heap says nothing (a bigger frame legitimately needs more).
      // Each frame moves the same station by the same small step around a
      // cycle, so every frame is the same job on the same geometry.
      const samples: { frame: number; mb: number; faces: number; ms: number }[] = [];
      let faces0 = 0;
      let window: number[] = [];
      for (let f = 1; f <= FRAMES; f++) {
        const dx = (f % 8) - 4;
        const dy = ((f * 3) % 8) - 4;
        const t0 = performance.now();
        const faces = runFrame(doc, movedBy(doc.stations, id, dx, dy));
        window.push(performance.now() - t0);
        if (f === 1) faces0 = faces;
        if (f % SAMPLE_EVERY === 0) {
          // FRAME TIME, sampled beside the heap. This is the whole point: a
          // growing heap that costs nothing is not the bug we are hunting. If
          // this column stays flat while MB climbs, the wasm growth is a red
          // herring and the slowdown lives somewhere else entirely.
          const sorted = [...window].sort((a, b) => a - b);
          samples.push({
            frame: f,
            mb: clipperHeapBytes() / MB,
            faces,
            ms: sorted[Math.floor(sorted.length / 2)],
          });
          window = [];
        }
      }

      console.log(`\n=== clipper wasm heap over ${FRAMES} identical-size frames ===`);
      console.log(`  at load        ${(at0 / MB).toFixed(1)} MB`);
      console.log(`  after warmup   ${(afterWarmup / MB).toFixed(1)} MB   (40 frames)`);
      for (const s of samples) {
        console.log(
          `  frame ${String(s.frame).padStart(5)}   ${s.mb.toFixed(1).padStart(6)} MB   ` +
            `median ${s.ms.toFixed(1).padStart(6)} ms   faces=${s.faces}`,
        );
      }

      const first = samples[0];
      const last = samples[samples.length - 1];
      const secondHalf = samples.slice(Math.floor(samples.length / 2));
      const growthInSecondHalf = secondHalf[secondHalf.length - 1].mb - secondHalf[0].mb;

      console.log(
        `\n  ${first.mb.toFixed(1)} -> ${last.mb.toFixed(1)} MB ` +
          `(${(last.mb / first.mb).toFixed(2)}x over ${FRAMES} frames)`,
      );
      console.log(
        `  growth in the SECOND HALF alone: ${growthInSecondHalf >= 0 ? '+' : ''}` +
          `${growthInSecondHalf.toFixed(1)} MB`,
      );
      console.log(
        growthInSecondHalf > 1
          ? '  => STILL CLIMBING after the high-water mark should have settled.\n' +
              '     That is a leak, not a working-set plateau.'
          : '  => settled. The early rise is a high-water mark, which is harmless.',
      );
      const msFirst = samples[0].ms;
      const msLast = last.ms;
      console.log(
        `  frame time ${msFirst.toFixed(1)} -> ${msLast.toFixed(1)} ms ` +
          `(${(msLast / msFirst).toFixed(2)}x)`,
      );
      console.log(
        msLast / msFirst > 1.2
          ? '  => frame time tracks the heap. The growth COSTS something.'
          : '  => frame time is flat while the heap climbs. The wasm growth is NOT ' +
            'what is slowing the drag; look elsewhere.',
      );

      // Frame size really was constant — else the whole comparison is void.
      // The station walks a small cycle, so the arrangement wobbles by a face
      // or two; that is not the "frames got bigger" drift this guards against.
      expect(
        Math.abs(last.faces - faces0) / faces0,
        'frame size drifted; the comparison is not like-for-like',
      ).toBeLessThan(0.05);
    },
    LONG,
  );
});
