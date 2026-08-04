/**
 * The main-thread side of the pipelined region worker: decides WHEN to
 * pipeline, keeps the worker's mirror warm, submits frames, and lands
 * results as coherent render frames.
 *
 * Shape of a pipelined drag: the gesture keeps writing the live doc per
 * pointermove exactly as today. Once a synchronous region build reports a
 * frame cost over the threshold while a deferPersist gesture is open, the
 * pipeline arms — it freezes the render source at the current slice and
 * starts submitting frames. Depth-1 with latest-wins coalescing: one frame
 * in flight; doc writes while waiting mark `pending`, and the next frame is
 * built from the then-latest doc. Each RESULT lands the frame's doc-slice
 * snapshot and its holes in one synchronous block, so React paints them as
 * one coherent frame. Every gesture exit — commit, rollback, steal — drains:
 * disarm, drop the in-flight generation, snap the render source back to the
 * live doc, resync the mirror. The synchronous path is never deleted; it is
 * the at-rest path, the small-map path, and the fallback whenever the worker
 * fails or a frame times out.
 *
 * Between arming and the first RESULT the canvas keeps deriving holes
 * synchronously from the frozen slice (MapCanvas's memos), so strokes and
 * clips resolve from one source in every frame bar none — there is no seeded
 * hand-off to get wrong.
 */
import { onHistoryGroup, useDoc, type DocSnapshot } from '../state/store';
import { pickDragFrameDoc, setRenderDocOverlay } from '../state/renderDoc';
import { setDragFrameHoles } from '../state/dragFrame';
import { diffMirror, unpackHoles, type RegionMirror } from './regionFrame';
import type { FrameResult, WorkerErrorResponse, WorkerRequest, WorkerResponse } from './regionWorker';

/** A pipelined frame must beat this (ms of synchronous region build) to be
 *  worth the messaging; below it the sync path is already smooth. */
export const ARM_THRESHOLD_MS = 30;

/** What `new Worker` gives us, narrowed to what the pipeline touches —
 *  injectable so unit tests drive the protocol without a real worker. */
export interface WorkerLike {
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

const defaultFactory = (): WorkerLike =>
  new Worker(new URL('./regionWorker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;

let factory: () => WorkerLike = defaultFactory;
let enabled = false;
let worker: WorkerLike | null = null;
/** The mirror as of the last message posted — the diff base. Null after a
 *  worker (re)creation: the next sync sends everything. */
let lastPosted: RegionMirror | null = null;
/** Gesture generation: bumped on every drain, so a RESULT computed for a
 *  finished gesture can never land on the next one. */
let gen = 0;
let seq = 0;
let anyGroupOpen = false;
let deferGroupOpen = false;
let armed = false;
let armQueued = false;
/** Worker failed mid-gesture: stay synchronous until the gesture ends. */
let brokenThisGesture = false;
let inFlight: { seq: number; snapshot: ReturnType<typeof pickDragFrameDoc> } | null = null;
let pending = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
/** Exponential average of frame round-trips, for the timeout watchdog. */
let emaMs = 200;
let disposers: (() => void)[] = [];

type MirrorSource = Pick<
  DocSnapshot,
  'stations' | 'lines' | 'lineCircles' | 'lineOrder' | 'regionAssignments'
>;

const mirrorOf = (s: MirrorSource): RegionMirror => ({
  stations: s.stations,
  lines: s.lines,
  lineCircles: s.lineCircles,
  lineOrder: s.lineOrder,
  regionAssignments: s.regionAssignments,
});

const clearTimer = (): void => {
  if (timeoutId !== null) clearTimeout(timeoutId);
  timeoutId = null;
};

const ensureWorker = (): WorkerLike => {
  if (worker) return worker;
  worker = factory();
  lastPosted = null;
  worker.onmessage = (e) => handleMessage(e.data);
  worker.onerror = () => fallback();
  worker.postMessage({ kind: 'warm' });
  return worker;
};

/** Post the diff that brings the worker to the current doc, outside any
 *  frame. No-op when the mirror is already current. */
const postSync = (s: MirrorSource): void => {
  if (!worker) return;
  const cur = mirrorOf(s);
  const sync = diffMirror(cur, lastPosted);
  lastPosted = cur;
  if (sync) worker.postMessage({ kind: 'sync', sync });
};

const sendFrame = (): void => {
  const w = ensureWorker();
  const s = useDoc.getState();
  const cur = mirrorOf(s);
  const sync = diffMirror(cur, lastPosted);
  lastPosted = cur;
  seq++;
  inFlight = { seq, snapshot: pickDragFrameDoc(s) };
  lastSentAt = performance.now();
  w.postMessage({ kind: 'frame', gen, seq, sync });
  clearTimer();
  const budget = Math.min(5000, Math.max(500, 2.5 * emaMs));
  const frameGen = gen;
  timeoutId = setTimeout(() => {
    if (gen === frameGen && inFlight) fallback();
  }, budget);
};

/** When the in-flight frame was posted (depth-1: one frame, one stamp). */
let lastSentAt = 0;

const handleMessage = (msg: WorkerResponse): void => {
  if (msg.kind === 'result') return handleResult(msg);
  if (msg.kind === 'error') return handleError(msg);
  // 'pong' belongs to the dev handle's health probe, which runs its own
  // worker instance; nothing to do here.
};

const handleResult = (msg: FrameResult): void => {
  if (msg.gen !== gen || !armed) return; // a drained gesture's leftovers
  if (!inFlight || msg.seq !== inFlight.seq) return;
  clearTimer();
  emaMs = 0.7 * emaMs + 0.3 * (performance.now() - lastSentAt);
  const holes = unpackHoles({ index: msg.index, coords: msg.coords });
  // One synchronous block ⇒ one React render: the snapshot these holes were
  // computed FROM and the holes themselves can never paint apart.
  setDragFrameHoles(holes);
  setRenderDocOverlay(inFlight.snapshot);
  inFlight = null;
  if (pending) {
    pending = false;
    sendFrame();
  }
};

const handleError = (msg: WorkerErrorResponse): void => {
  // Any worker-side failure mid-gesture: back to the synchronous path.
  console.error('[regionPipeline] worker error:', msg.message, msg.stack ?? '');
  fallback();
};

/**
 * The worker is unusable (error, timeout, load failure): abandon pipelining
 * for the rest of this gesture and reset the worker. The gesture itself is
 * untouched — the doc was live all along; the canvas snaps forward to it and
 * the next pointermove resumes synchronous builds.
 */
const fallback = (): void => {
  clearTimer();
  armed = false;
  pending = false;
  inFlight = null;
  brokenThisGesture = true;
  gen++;
  setDragFrameHoles(null);
  setRenderDocOverlay(null);
  worker?.terminate();
  worker = null;
  lastPosted = null;
};

/** Every gesture exit: disarm, drop the generation, converge, resync. */
const drain = (): void => {
  clearTimer();
  const wasArmed = armed;
  armed = false;
  pending = false;
  inFlight = null;
  gen++;
  if (wasArmed) {
    setDragFrameHoles(null);
    setRenderDocOverlay(null);
  }
  if (worker && enabled) postSync(useDoc.getState());
};

const arm = (): void => {
  armQueued = false;
  if (!enabled || armed || !deferGroupOpen || brokenThisGesture) return;
  armed = true;
  // Freeze the canvas at the current slice; the gesture's further writes
  // stop notifying it. The canvas's own memos keep serving this slice's
  // synchronous holes until the first RESULT lands.
  setRenderDocOverlay(pickDragFrameDoc(useDoc.getState()));
  sendFrame();
};

/**
 * MapCanvas reports every synchronous region build's cost. Crossing the
 * threshold while a deferPersist gesture is open arms the pipeline — from
 * the next frame on, that cost moves off this thread. Called during render,
 * so the arm (which writes stores) is deferred a microtask.
 */
export function reportSyncRegionCost(ms: number): void {
  if (!enabled || armed || !deferGroupOpen || brokenThisGesture) return;
  if (ms <= ARM_THRESHOLD_MS || armQueued) return;
  armQueued = true;
  queueMicrotask(arm);
}

export function setRegionPipelineEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  if (!on) {
    if (armed) drain();
    worker?.terminate();
    worker = null;
    lastPosted = null;
  }
}

export function regionPipelineStatus(): {
  enabled: boolean;
  armed: boolean;
  workerAlive: boolean;
  gen: number;
  seq: number;
} {
  return { enabled, armed, workerAlive: worker !== null, gen, seq };
}

/**
 * Wire the pipeline to the stores. Called once from main.tsx; tests call it
 * with a fake worker factory and dispose between cases.
 */
export function initRegionPipeline(workerFactory?: () => WorkerLike): void {
  disposeRegionPipeline();
  if (workerFactory) factory = workerFactory;
  disposers.push(
    onHistoryGroup((e) => {
      if (e.kind === 'begin') {
        anyGroupOpen = true;
        deferGroupOpen = e.deferPersist;
      } else {
        anyGroupOpen = false;
        deferGroupOpen = false;
        brokenThisGesture = false;
        // Commit boundary: converge and bring the mirror up to the committed
        // doc (drain also covers the unarmed case's resync).
        drain();
      }
    }),
    useDoc.subscribe((s) => {
      if (armed) {
        if (inFlight) pending = true;
        else sendFrame();
        return;
      }
      // At-rest mirror warmth: post commit-cadence diffs, never per-frame —
      // grouped writes wait for the group's end (drain resyncs there).
      if (enabled && worker && !anyGroupOpen) postSync(s);
    }),
  );
}

export function disposeRegionPipeline(): void {
  for (const d of disposers) d();
  disposers = [];
  clearTimer();
  armed = false;
  armQueued = false;
  pending = false;
  inFlight = null;
  anyGroupOpen = false;
  deferGroupOpen = false;
  brokenThisGesture = false;
  worker?.terminate();
  worker = null;
  lastPosted = null;
  factory = defaultFactory;
  setDragFrameHoles(null);
  setRenderDocOverlay(null);
}
