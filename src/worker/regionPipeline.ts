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
import { setDragFrame } from '../state/dragFrame';
import type { SnapGuide } from '../geometry/snap';
import { diffMirror, unpackHoles, type RegionMirror } from './regionFrame';
import type {
  FrameResult,
  WorkerErrorResponse,
  WorkerRequest,
  WorkerResponse,
} from './regionWorker';

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
// ON by default since the Aug 3 A/B (4-13x main-thread liveness, visual
// parity — see .perf/RESULTS.md); __massimo.regionPipeline.enable(false) is
// the kill switch. Arming is still gated per-gesture, so small and
// regionless maps never leave the synchronous path.
let enabled = true;
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
let inFlight: {
  seq: number;
  snapshot: ReturnType<typeof pickDragFrameDoc>;
  guides: SnapGuide[];
} | null = null;
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

/** False from a worker's creation until its first accepted RESULT: the boot
 *  (spawn + wasm compile) may still be in progress no matter how current the
 *  mirror is, so the watchdog budget keys on THIS, not on `lastPosted`. */
let workerWarm = false;

const ensureWorker = (): WorkerLike => {
  if (worker) return worker;
  worker = factory();
  lastPosted = null;
  workerWarm = false;
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
  inFlight = { seq, snapshot: pickDragFrameDoc(s), guides: pendingGuidesUnion() };
  lastSentAt = performance.now();
  w.postMessage({ kind: 'frame', gen, seq, sync });
  clearTimer();
  // A frame sent to a worker that has never answered may still be paying
  // spawn + wasm compile + a full build (a warm mirror proves nothing — the
  // begin-time sync posts before the boot finishes); the warm-frame watchdog
  // would declare it dead and terminate the half-booted worker. Boot-sized
  // budget until the worker's first accepted RESULT.
  const budget = workerWarm ? Math.min(5000, Math.max(500, 2.5 * emaMs)) : 5000;
  const frameGen = gen;
  timeoutId = setTimeout(() => {
    if (gen === frameGen && inFlight) fallback();
  }, budget);
};

/** The idle-path frame send, deferred one microtask so it captures the input
 *  handler's END state. A pointermove often writes the doc more than once
 *  (moveStation then translateSiblings; a capture then its slide) and
 *  publishes guides AFTER the writes — a send fired synchronously from
 *  inside the first write would snapshot a half-applied input carrying the
 *  previous input's guides. Mirrors the `armQueued` pattern.
 */
let sendQueued = false;
const queueSend = (): void => {
  if (sendQueued) return;
  sendQueued = true;
  queueMicrotask(() => {
    sendQueued = false;
    if (armed && !inFlight) sendFrame();
  });
};

/** When the in-flight frame was posted (depth-1: one frame, one stamp). */
let lastSentAt = 0;

/**
 * The sources a pipelined gesture's snap guides can come from — the five
 * armable drag hooks. Union order is the paint stacking order, fixed so a
 * frame's guides render deterministically.
 */
const GUIDE_SOURCES = ['station', 'item', 'polygon', 'svgImage', 'lineCircle'] as const;
export type SnapGuideSource = (typeof GUIDE_SOURCES)[number];

/** The latest guides published per source — the input-time truth the next
 *  frame carries. Recorded at rest too, so arming inherits the guides the
 *  canvas is already showing instead of blanking them for one compute-frame. */
let pendingGuides: Partial<Record<SnapGuideSource, SnapGuide[]>> = {};

const pendingGuidesUnion = (): SnapGuide[] => {
  const union: SnapGuide[] = [];
  for (const s of GUIDE_SOURCES) {
    const g = pendingGuides[s];
    if (g) union.push(...g);
  }
  return union;
};

/**
 * Drag hooks publish every guide update through here, in the same pointermove
 * that writes the doc. While armed the guides become the NEXT frame's cargo
 * (returns true: the hook must not touch its own live state, or a guide from
 * input N would paint over frame N-1); at rest they stay the hook's business
 * (returns false).
 */
export function routeSnapGuides(source: SnapGuideSource, guides: SnapGuide[]): boolean {
  pendingGuides[source] = guides;
  return armed;
}

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
  workerWarm = true;
  emaMs = 0.7 * emaMs + 0.3 * (performance.now() - lastSentAt);
  const holes = unpackHoles({ index: msg.index, coords: msg.coords });
  // One synchronous block ⇒ one React render: the snapshot these holes were
  // computed FROM, the guides published with its input, and the holes
  // themselves can never paint apart.
  setDragFrame({ holes, guides: inFlight.guides });
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
  pendingGuides = {};
  brokenThisGesture = true;
  gen++;
  setDragFrame(null);
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
  pendingGuides = {};
  gen++;
  if (wasArmed) {
    setDragFrame(null);
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
  if (ms <= (armThresholdOverride ?? ARM_THRESHOLD_MS) || armQueued) return;
  armQueued = true;
  queueMicrotask(arm);
}

/** e2e-only: a small map's builds never cross the real threshold, so the
 *  suite lowers it to exercise arming at all. Null = the real constant. */
let armThresholdOverride: number | null = null;

export function setRegionPipelineEnabled(on: boolean, opts?: { armThresholdMs?: number }): void {
  armThresholdOverride = opts?.armThresholdMs ?? null;
  if (enabled === on) return;
  enabled = on;
  if (!on) {
    if (armed) drain();
    worker?.terminate();
    worker = null;
    lastPosted = null;
  }
}

/** e2e fault injection: kill the live worker out from under the pipeline —
 *  it must notice via the frame timeout and fall back synchronously. */
export function killRegionPipelineWorkerForTest(): void {
  worker?.terminate();
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
        // Boot at pointerdown on a map that could arm: worker spawn + wasm
        // compile + the full-slice sync all overlap the gesture's cheap
        // early frames, so by the time a slow build reports, the mirror is
        // warm and the first pipelined frame is an incremental diff.
        // (Assignments-exist is the pipeline-side proxy for needRegions;
        // repeat begins are ~free — the identity diff no-ops.)
        if (
          e.deferPersist &&
          enabled &&
          Object.keys(useDoc.getState().regionAssignments).length > 0
        ) {
          ensureWorker();
          postSync(useDoc.getState());
        }
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
        else queueSend();
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
  pendingGuides = {};
  anyGroupOpen = false;
  deferGroupOpen = false;
  brokenThisGesture = false;
  worker?.terminate();
  worker = null;
  lastPosted = null;
  factory = defaultFactory;
  armThresholdOverride = null;
  setDragFrame(null);
  setRenderDocOverlay(null);
}
