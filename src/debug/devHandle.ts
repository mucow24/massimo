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

export interface DevHandle {
  counters: () => DevCounters;
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
