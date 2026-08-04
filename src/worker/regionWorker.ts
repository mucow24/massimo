/**
 * The region worker: a second clipper engine on a background thread.
 *
 * This module is loaded as a Vite module worker (`new Worker(new URL(...),
 * { type: 'module' })`), so it carries its own instance of everything the
 * geometry chain owns at module level — the clipper WASM, the incremental
 * region state and the hole cache (via regionFrame's imports). Nothing here
 * may touch the DOM, React, or the stores; the compute chain is verified pure
 * (the whole point of running it here).
 *
 * The shell is deliberately thin: hold the mirror, apply SYNCs, and answer
 * FRAMEs with packed holes. All logic lives in regionFrame.ts, where vitest
 * pins it byte-equal to the synchronous path without spawning a worker.
 *
 * Protocol datums are plain structured-cloneable objects. Errors cross as an
 * explicit envelope — structured clone demotes Error subclasses to plain
 * `Error` and drops own properties, so `ClipperUnavailableError.reason` and
 * friends would silently vanish without one.
 */
import { intersect, loadClipper, type Ring } from '../geometry/clip';
import {
  applyMirrorSync,
  computeMirrorHoles,
  packHoles,
  type MirrorSync,
  type PackedHoles,
  type RegionMirror,
} from './regionFrame';

/** Health probe: load the engine, run one fixed op, return the rings. The
 *  main thread byte-compares them against its own engine's answer — the two
 *  instances run the same WASM build on the same integer-snapped inputs, so
 *  any difference means the worker build is broken, not "close enough". */
export interface PingRequest {
  kind: 'ping';
}

/** Load the engine ahead of the first frame, so arming never pays it. */
export interface WarmRequest {
  kind: 'warm';
}

/** Bring the worker's mirror up to date. No reply. */
export interface SyncRequest {
  kind: 'sync';
  sync: MirrorSync;
}

/** One drag frame: apply the diff, compute the holes, answer. */
export interface FrameRequest {
  kind: 'frame';
  gen: number;
  seq: number;
  sync: MirrorSync | null;
}

export interface PongResponse {
  kind: 'pong';
  rings: Ring[];
  /** Worker-side wasm linear memory, for the perf panel's counters. */
  wasmBytes: number;
}

export interface FrameResult {
  kind: 'result';
  gen: number;
  seq: number;
  index: PackedHoles['index'];
  /** Transferred, not cloned — the buffer moves realms. */
  coords: Float64Array;
}

export interface WorkerErrorResponse {
  kind: 'error';
  message: string;
  stack?: string;
  /** Present when the failure belongs to a specific frame. */
  gen?: number;
  seq?: number;
}

export type WorkerRequest = PingRequest | WarmRequest | SyncRequest | FrameRequest;
export type WorkerResponse = PongResponse | FrameResult | WorkerErrorResponse;

/** The fixed probe op: two overlapping axis-aligned squares. */
export function pingRings(): Ring[] {
  const square = (x0: number, y0: number, x1: number, y1: number): Ring[] => [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  ];
  return intersect(square(0, 0, 10, 10), square(5, 5, 15, 15));
}

const toErrorEnvelope = (
  err: unknown,
  frame?: { gen: number; seq: number },
): WorkerErrorResponse => ({
  kind: 'error',
  message: err instanceof Error ? err.message : String(err),
  stack: err instanceof Error ? err.stack : undefined,
  ...frame,
});

const EMPTY_MIRROR: RegionMirror = {
  stations: {},
  lines: {},
  lineCircles: {},
  lineOrder: [],
  regionAssignments: {},
};

let mirror: RegionMirror = EMPTY_MIRROR;

// `self` is the DedicatedWorkerGlobalScope; typing stays loose so this module
// can also be imported (for its exported helpers/types) from main-thread code
// and tests without dragging worker lib types into the app's tsconfig.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (e: MessageEvent) => {
  const msg = e.data as WorkerRequest;
  if (!msg) return;
  switch (msg.kind) {
    case 'sync':
      mirror = applyMirrorSync(mirror, msg.sync);
      return;
    case 'frame': {
      if (msg.sync) mirror = applyMirrorSync(mirror, msg.sync);
      const frame = { gen: msg.gen, seq: msg.seq };
      void (async () => {
        try {
          await loadClipper();
          const packed = packHoles(computeMirrorHoles(mirror));
          scope.postMessage(
            { kind: 'result', ...frame, index: packed.index, coords: packed.coords },
            [packed.coords.buffer],
          );
        } catch (err) {
          scope.postMessage(toErrorEnvelope(err, frame));
        }
      })();
      return;
    }
    case 'warm':
      void loadClipper().catch(() => {
        // A load failure surfaces on the first frame (or ping) instead; the
        // warm-up itself has no reply channel to report on.
      });
      return;
    case 'ping':
      void (async () => {
        try {
          await loadClipper();
          const { clipperHeapBytes } = await import('../geometry/clip');
          scope.postMessage({ kind: 'pong', rings: pingRings(), wasmBytes: clipperHeapBytes() });
        } catch (err) {
          scope.postMessage(toErrorEnvelope(err));
        }
      })();
      return;
  }
};
