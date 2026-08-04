/**
 * Debug handle on `window.__massimo`, installed by main.tsx in every build —
 * the perf harnesses measure production, and a slowdown that takes an hour to
 * appear has to be catchable in whichever build happens to be open.
 *
 * It exists for ONE question: a session that has been edited for an hour drags
 * at a few fps, and a reload cures it — so which of the things a reload resets
 * is the one that matters? Each reset below is a piece of what reloading does,
 * available without reloading. Run them one at a time while the app is slow;
 * the one that restores speed names the owner.
 *
 * `counters()` is the other half: a flat bag of numbers, sampled the same way
 * every time, so "it feels slower" becomes a series. The DOM counts are first-
 * class rather than an afterthought — a pan is compositor-only once it starts,
 * so growing click-to-pan latency is a raster cost, and raster cost tracks how
 * much painted content the map layer holds.
 */
import { clipperHeapBytes } from '../geometry/clip';
import { resetExclusionHoleCache } from '../geometry/lineRegions';
import { regionCacheSize, resetRegionCache } from '../geometry/regionCache';
import { parse, serialize } from '../model/serialize';
import { clearHistory, historyDepth, redoDepth } from '../state/history';
import { useDoc } from '../state/store';
import {
  killRegionPipelineWorkerForTest,
  regionPipelineStatus,
  setRegionPipelineEnabled,
} from '../worker/regionPipeline';

export interface DevCounters {
  /** JS heap in MB. Chrome-only and quantized; absent elsewhere. */
  heapMB: number;
  /** Wasm linear memory in MB — grows, never shrinks. */
  wasmMB: number;
  /** Undo / redo stack depths. One grouped entry per gesture. */
  past: number;
  future: number;
  /** Live geometry caches. Both are capped, so a climb here is a bug. */
  regionCache: number;
  /** Painted content in the composited pan layer — the raster-cost proxy. */
  svgNodes: number;
  defsNodes: number;
  clipPaths: number;
  /** Doc size. Climbs only if an edit path is accreting records. */
  stations: number;
  lines: number;
  regionAssignments: number;
}

const MB = 1024 * 1024;

const countIn = (root: Element | null, sel: string): number =>
  root ? root.querySelectorAll(sel).length : 0;

export function devCounters(): DevCounters {
  const doc = useDoc.getState();
  const layer = document.querySelector('.canvas-pan-layer');
  // Non-standard and Chrome-only; the harness tolerates 0.
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    heapMB: mem ? +(mem.usedJSHeapSize / MB).toFixed(1) : 0,
    wasmMB: +(clipperHeapBytes() / MB).toFixed(1),
    past: historyDepth(),
    future: redoDepth(),
    regionCache: regionCacheSize(),
    svgNodes: countIn(layer, '*'),
    defsNodes: countIn(layer, 'defs *'),
    clipPaths: countIn(layer, 'clipPath'),
    stations: Object.keys(doc.stations).length,
    lines: Object.keys(doc.lines).length,
    regionAssignments: Object.keys(doc.regionAssignments).length,
  };
}

/**
 * Round-trip the live doc through the file format, in place. This is what
 * rehydrating on reload does — the same sanitizers, the same backfills, the
 * same pruning of assignments whose geometry is gone. If THIS is the reset
 * that restores speed, the growth is in the document, not in memory.
 *
 * Returns false (leaving the doc untouched) if the round-trip does not survive
 * its own parse, which would make anything it told us worthless. `parse` is
 * not total — it throws on a doc malformed enough that its sanitizers cannot
 * walk it — and a diagnostic that throws mid-bisect is worse than useless, so
 * the throw is caught rather than assumed away.
 */
export function roundTripDoc(): boolean {
  let result;
  try {
    result = parse(serialize(useDoc.getState()));
  } catch (err) {
    console.error('[__massimo] doc round-trip threw; doc left alone', err);
    return false;
  }
  if (!result.ok) {
    console.error('[__massimo] doc round-trip failed to parse; doc left alone', result.error);
    return false;
  }
  useDoc.setState(result.doc);
  return true;
}

/**
 * Spawn the region worker, run its health probe, and byte-compare its rings
 * against the main-thread engine's answer to the same op. This is the S1
 * feasibility gate made permanent: it exercises the exact packaging chain a
 * pipelined drag depends on (module-worker construction relative to
 * `import.meta.url`, the clipper's dynamic import + WASM fetch inside the
 * worker chunk, structured-clone across the boundary) in whichever build is
 * open — the dev server's untransformed URLs and the prod build's relative
 * base fail in DIFFERENT ways, so the e2e suite runs it in both.
 */
export async function workerPing(): Promise<{
  ok: boolean;
  identical: boolean;
  workerRings?: unknown;
  mainRings?: unknown;
  wasmBytes?: number;
  error?: string;
}> {
  // The probe op comes from the PURE module — importing the shell here would
  // execute its top-level `self.onmessage = …` with self === window.
  const { pingRings } = await import('../worker/regionFrame');
  const worker = new Worker(new URL('../worker/regionWorker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker ping timed out (10s)')), 10000);
      worker.onmessage = (e) => {
        clearTimeout(timeout);
        resolve(e.data as Record<string, unknown>);
      };
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`worker failed to load: ${e.message}`));
      };
      worker.postMessage({ kind: 'ping' });
    });
    if (response.kind === 'error') {
      return { ok: false, identical: false, error: String(response.message) };
    }
    const mainRings = pingRings();
    return {
      ok: true,
      identical: JSON.stringify(response.rings) === JSON.stringify(mainRings),
      workerRings: response.rings,
      mainRings,
      wasmBytes: response.wasmBytes as number,
    };
  } catch (err) {
    return { ok: false, identical: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    worker.terminate();
  }
}

export interface DevHandle {
  counters: () => DevCounters;
  /** The region worker's health probe (see {@link workerPing}). */
  workerPing: () => ReturnType<typeof workerPing>;
  /** The pipelined-drag flag: on by default (see .perf/RESULTS.md);
   *  enable(false) is the kill switch, status() the inspector. */
  regionPipeline: {
    enable: (on: boolean, opts?: { armThresholdMs?: number }) => void;
    status: () => ReturnType<typeof regionPipelineStatus>;
    /** e2e fault injection: kill the worker mid-drag; the pipeline must
     *  time out and fall back synchronously. */
    kill: () => void;
  };
  reset: {
    /** Drop the undo/redo stacks. */
    history: () => void;
    /** Drop the region LRU, the incremental seed, and the hole cache. */
    regions: () => void;
    /** Re-parse the doc in place, as a reload would. */
    doc: () => boolean;
    /** Everything above, in one go. */
    all: () => void;
  };
}

export function makeDevHandle(): DevHandle {
  return {
    counters: devCounters,
    workerPing,
    regionPipeline: {
      enable: setRegionPipelineEnabled,
      status: regionPipelineStatus,
      kill: killRegionPipelineWorkerForTest,
    },
    reset: {
      history: clearHistory,
      regions: () => {
        resetRegionCache();
        resetExclusionHoleCache();
      },
      doc: roundTripDoc,
      all: () => {
        resetRegionCache();
        resetExclusionHoleCache();
        // Last, because `roundTripDoc`'s in-place `setState` is itself recorded
        // as an undo step — clearing before it would leave the round-trip on
        // the stack, and `reset.all` is meant to land where a reload does, with
        // an empty history.
        roundTripDoc();
        clearHistory();
      },
    },
  };
}

/** Attach the handle to `window`. Called from main.tsx once the app mounts. */
export function installDevHandle(): void {
  (globalThis as unknown as { __massimo?: DevHandle }).__massimo = makeDevHandle();
}
