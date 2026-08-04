/**
 * The region worker: a second clipper engine on a background thread.
 *
 * This module is loaded as a Vite module worker (`new Worker(new URL(...),
 * { type: 'module' })`), so it carries its own instance of everything the
 * geometry chain owns at module level — the clipper WASM, and later the
 * incremental region state and hole cache. Nothing here may touch the DOM,
 * React, or the stores; the compute chain is verified pure (the whole point
 * of running it here).
 *
 * Protocol datums are plain structured-cloneable objects. Errors cross as an
 * explicit envelope — structured clone demotes Error subclasses to plain
 * `Error` and drops own properties, so `ClipperUnavailableError.reason` and
 * friends would silently vanish without one.
 */
import { intersect, loadClipper, type Ring } from '../geometry/clip';

/** Health probe: load the engine, run one fixed op, return the rings. The
 *  main thread byte-compares them against its own engine's answer — the two
 *  instances run the same WASM build on the same integer-snapped inputs, so
 *  any difference means the worker build is broken, not "close enough". */
export interface PingRequest {
  kind: 'ping';
}

export interface PongResponse {
  kind: 'pong';
  rings: Ring[];
  /** Worker-side wasm linear memory, for the perf panel's counters. */
  wasmBytes: number;
}

export interface WorkerErrorResponse {
  kind: 'error';
  message: string;
  stack?: string;
}

export type WorkerRequest = PingRequest;
export type WorkerResponse = PongResponse | WorkerErrorResponse;

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

const toErrorEnvelope = (err: unknown): WorkerErrorResponse => ({
  kind: 'error',
  message: err instanceof Error ? err.message : String(err),
  stack: err instanceof Error ? err.stack : undefined,
});

// `self` is the DedicatedWorkerGlobalScope; typing stays loose so this module
// can also be imported (for its exported helpers/types) from main-thread code
// and tests without dragging worker lib types into the app's tsconfig.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

scope.onmessage = (e: MessageEvent) => {
  const msg = e.data as WorkerRequest;
  if (!msg || msg.kind !== 'ping') return;
  void (async () => {
    try {
      await loadClipper();
      const { clipperHeapBytes } = await import('../geometry/clip');
      scope.postMessage({ kind: 'pong', rings: pingRings(), wasmBytes: clipperHeapBytes() });
    } catch (err) {
      scope.postMessage(toErrorEnvelope(err));
    }
  })();
};
