import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ARM_THRESHOLD_MS,
  disposeRegionPipeline,
  initRegionPipeline,
  regionPipelineStatus,
  reportSyncRegionCost,
  routeSnapGuides,
  setRegionPipelineEnabled,
  type WorkerLike,
} from './regionPipeline';
import type { SnapGuide } from '../geometry/snap';
import { packHoles } from './regionFrame';
import type { FrameRequest, WorkerRequest, WorkerResponse } from './regionWorker';
import { beginHistoryGroup, useDoc } from '../state/store';
import { renderDocArmed, useRenderDoc } from '../state/renderDoc';
import { useDragFrame } from '../state/dragFrame';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStation } from '../test/fixtures';
import type { LineId } from '../model/types';
import type { Ring } from '../geometry/clip';

// The pipeline's whole contract, driven through the REAL stores and history
// groups with only the worker faked: when it arms, how frames coalesce, how a
// RESULT lands as one coherent frame, and that EVERY gesture exit — commit,
// rollback, steal — drains it. The worker's compute is pinned separately
// (regionFrame.test.ts); here its answers are canned.

class FakeWorker implements WorkerLike {
  posts: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(msg: WorkerRequest): void {
    this.posts.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  deliver(msg: WorkerResponse): void {
    this.onmessage?.({ data: msg });
  }
  frames(): FrameRequest[] {
    return this.posts.filter((p): p is FrameRequest => p.kind === 'frame');
  }
}

const holesOf = (lineId: string, x: number): Map<LineId, Ring[]> =>
  new Map([
    [
      lineId,
      [
        [
          { x, y: 0 },
          { x: x + 1, y: 0 },
          { x: x + 1, y: 1 },
        ],
      ],
    ],
  ]);

const resultFor = (frame: FrameRequest, holes: Map<LineId, Ring[]>): WorkerResponse => {
  const packed = packHoles(holes);
  return {
    kind: 'result',
    gen: frame.gen,
    seq: frame.seq,
    index: packed.index,
    coords: packed.coords,
  };
};

const flushMicrotasks = () => Promise.resolve();

let fake: FakeWorker;
let created = 0;

const seedStation = () => {
  useDoc.setState({
    ...useDoc.getState(),
    stations: { s1: makeStation({ id: 's1', x: 0, y: 0 }) },
  });
};

/** Open a canvas-style gesture, write one move, and arm the pipeline. */
const armMidGesture = async (x = 10) => {
  const group = beginHistoryGroup({ deferPersist: true });
  useDoc.getState().moveStation('s1', x, 0);
  reportSyncRegionCost(ARM_THRESHOLD_MS + 20);
  await flushMicrotasks();
  return group;
};

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  seedStation();
  created = 0;
  initRegionPipeline(() => {
    created++;
    fake = new FakeWorker();
    return fake;
  });
  setRegionPipelineEnabled(true);
});

afterEach(() => {
  disposeRegionPipeline();
});

describe('arming', () => {
  it('arms only for a slow build inside a deferPersist gesture, freezing the render source', async () => {
    // No gesture open: a slow at-rest build must not arm.
    reportSyncRegionCost(100);
    await flushMicrotasks();
    expect(regionPipelineStatus().armed).toBe(false);

    // Cheap frames inside a gesture: stay synchronous.
    const g1 = beginHistoryGroup({ deferPersist: true });
    reportSyncRegionCost(ARM_THRESHOLD_MS - 10);
    await flushMicrotasks();
    expect(regionPipelineStatus().armed).toBe(false);
    g1.commit();

    const g2 = await armMidGesture(10);
    expect(regionPipelineStatus().armed).toBe(true);
    expect(renderDocArmed()).toBe(true);
    // The frozen slice is the doc as of arming.
    expect(useRenderDoc.getState().stations['s1'].x).toBe(10);
    g2.commit();
  });

  it('does not arm when disabled', async () => {
    setRegionPipelineEnabled(false);
    const g = await armMidGesture();
    expect(regionPipelineStatus().armed).toBe(false);
    g.commit();
  });
});

describe('frame flow', () => {
  it('depth-1 with latest-wins coalescing, each RESULT landing one coherent frame', async () => {
    const g = await armMidGesture(10);
    expect(fake.frames()).toHaveLength(1);
    // First frame: a cold mirror gets the full slice.
    expect(fake.frames()[0].sync?.stations?.['s1'].x).toBe(10);

    // Writes while a frame is in flight coalesce — nothing else is posted.
    useDoc.getState().moveStation('s1', 20, 0);
    useDoc.getState().moveStation('s1', 30, 0);
    expect(fake.frames()).toHaveLength(1);
    // The canvas still shows the armed slice; the live doc ran ahead.
    expect(useRenderDoc.getState().stations['s1'].x).toBe(10);

    // RESULT 1 lands: holes + that frame's snapshot arrive together, and the
    // pending write flushes as frame 2 built from the LATEST doc.
    const h1 = holesOf('l1', 100);
    fake.deliver(resultFor(fake.frames()[0], h1));
    expect(useDragFrame.getState().frame?.holes).toEqual(h1);
    expect(useRenderDoc.getState().stations['s1'].x).toBe(10);
    expect(fake.frames()).toHaveLength(2);
    expect(fake.frames()[1].sync?.stations?.['s1'].x).toBe(30);

    // RESULT 2: the canvas advances to frame 2's snapshot as one piece.
    const h2 = holesOf('l1', 200);
    fake.deliver(resultFor(fake.frames()[1], h2));
    expect(useDragFrame.getState().frame?.holes).toEqual(h2);
    expect(useRenderDoc.getState().stations['s1'].x).toBe(30);

    g.commit();
    expect(renderDocArmed()).toBe(false);
    expect(useDragFrame.getState().frame).toBeNull();
    // Converged: the render source mirrors the committed doc.
    expect(useRenderDoc.getState().stations['s1'].x).toBe(30);
  });
});

describe('drain on every exit', () => {
  it('commit drains, and a late RESULT from the drained gesture is dropped', async () => {
    const g = await armMidGesture(10);
    const frame = fake.frames()[0];
    g.commit();
    expect(regionPipelineStatus().armed).toBe(false);
    expect(renderDocArmed()).toBe(false);

    fake.deliver(resultFor(frame, holesOf('l1', 100)));
    expect(useDragFrame.getState().frame).toBeNull();
    expect(renderDocArmed()).toBe(false);
  });

  it('rollback drains and the canvas snaps back with the reverted doc', async () => {
    const g = await armMidGesture(10);
    useDoc.getState().moveStation('s1', 50, 0);
    g.rollback();
    expect(regionPipelineStatus().armed).toBe(false);
    expect(renderDocArmed()).toBe(false);
    // The doc reverted to the pre-gesture snapshot; the render source agrees.
    expect(useDoc.getState().stations['s1'].x).toBe(0);
    expect(useRenderDoc.getState().stations['s1'].x).toBe(0);
  });

  it('a steal (new begin over an open gesture) drains the elder', async () => {
    await armMidGesture(10);
    expect(regionPipelineStatus().armed).toBe(true);
    const thief = beginHistoryGroup();
    expect(regionPipelineStatus().armed).toBe(false);
    expect(renderDocArmed()).toBe(false);
    thief.commit();
  });
});

describe('fallback', () => {
  it('a worker error disarms, resumes sync, and stays sync for the rest of the gesture', async () => {
    const g = await armMidGesture(10);
    fake.deliver({ kind: 'error', message: 'wasm exploded' });
    expect(regionPipelineStatus().armed).toBe(false);
    expect(renderDocArmed()).toBe(false);
    expect(useDragFrame.getState().frame).toBeNull();
    expect(fake.terminated).toBe(true);

    // Still mid-gesture: another slow frame must NOT re-arm a broken pipeline.
    reportSyncRegionCost(100);
    await flushMicrotasks();
    expect(regionPipelineStatus().armed).toBe(false);
    g.commit();

    // Next gesture: clean slate, fresh worker.
    const g2 = await armMidGesture(60);
    expect(regionPipelineStatus().armed).toBe(true);
    expect(created).toBe(2);
    g2.commit();
  });

  it("an error for a drained gesture's frame leaves the NEXT gesture free to arm", async () => {
    // The mirror of 'a late RESULT from the drained gesture is dropped': the
    // frame in flight at pointerup can fail AFTER the drain. That failure
    // belongs to a gesture that is already over — falling back on it would
    // hold the next gesture on the synchronous path for nothing.
    const g = await armMidGesture(10);
    const frame = fake.frames()[0];
    const dead = fake;
    g.commit();

    dead.deliver({ kind: 'error', message: 'clipper exploded', gen: frame.gen, seq: frame.seq });
    expect(dead.terminated).toBe(false);

    const g2 = await armMidGesture(60);
    expect(regionPipelineStatus().armed).toBe(true);
    g2.commit();
  });

  it('a stale error cannot disarm the gesture that came after it', async () => {
    const g = await armMidGesture(10);
    const stale = fake.frames()[0];
    g.commit();
    const g2 = await armMidGesture(60);
    expect(regionPipelineStatus().armed).toBe(true);

    fake.deliver({ kind: 'error', message: 'late', gen: stale.gen, seq: stale.seq });
    expect(regionPipelineStatus().armed).toBe(true);
    expect(renderDocArmed()).toBe(true);
    g2.commit();
  });

  it('a fallback between gestures does not disable the next one', async () => {
    // The worker can die at rest (its `onerror`, or a failure with no frame
    // stamp). `brokenThisGesture` is a per-GESTURE bail, so a gesture that had
    // not even started when the worker broke must still get to arm.
    (await armMidGesture(10)).commit();
    fake.onerror?.(new Error('worker died at rest'));

    const g = await armMidGesture(60);
    expect(regionPipelineStatus().armed).toBe(true);
    g.commit();
  });

  it('a frame timeout falls back the same way', async () => {
    vi.useFakeTimers();
    try {
      const group = beginHistoryGroup({ deferPersist: true });
      useDoc.getState().moveStation('s1', 10, 0);
      reportSyncRegionCost(100);
      await flushMicrotasks();
      expect(regionPipelineStatus().armed).toBe(true);

      vi.advanceTimersByTime(6000);
      expect(regionPipelineStatus().armed).toBe(false);
      expect(renderDocArmed()).toBe(false);
      expect(fake.terminated).toBe(true);
      group.commit();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('snap guides ride the frame', () => {
  const guideAt = (x: number): SnapGuide => ({ from: { x, y: 0 }, to: { x, y: 100 } });

  it('unarmed, routing declines and the hook keeps its local behavior', () => {
    expect(routeSnapGuides('station', [guideAt(1)])).toBe(false);
  });

  it('guides published with input N surface with frame N, not before', async () => {
    const g = await armMidGesture(10);

    // Input 2 arrives while frame 1 is in flight: its guides are routed into
    // the pipeline (the hook must not paint them over frame 0's snapshot).
    const g2 = [guideAt(20)];
    expect(routeSnapGuides('station', g2)).toBe(true);
    useDoc.getState().moveStation('s1', 20, 0);
    expect(useDragFrame.getState().frame).toBeNull();

    // Frame 1 lands (its input predates g2): no guides yet. The pending
    // write flushes as frame 2, carrying g2.
    fake.deliver(resultFor(fake.frames()[0], holesOf('l1', 100)));
    expect(useDragFrame.getState().frame?.guides).toEqual([]);

    // Frame 2 lands: g2 surfaces exactly when its snapshot paints.
    fake.deliver(resultFor(fake.frames()[1], holesOf('l1', 200)));
    expect(useDragFrame.getState().frame?.guides).toEqual(g2);

    g.commit();
    expect(useDragFrame.getState().frame).toBeNull();
  });

  it('a fallback carries the routed guides until the hooks take them back', async () => {
    // Routing returned true for these, so the hook is NOT painting them —
    // dropping the frame outright would blink the guide out mid-drag, on the
    // one input where the user is being told what they are snapping to.
    const g = await armMidGesture(10);
    const routed = [guideAt(20)];
    expect(routeSnapGuides('station', routed)).toBe(true);

    fake.deliver({ kind: 'error', message: 'wasm exploded' });

    // Holes go back to the synchronous build (null), but the guides survive.
    expect(useDragFrame.getState().frame?.holes ?? null).toBeNull();
    expect(useDragFrame.getState().frame?.guides).toEqual(routed);

    // The next publish is the hook's own again (routing now declines), so the
    // carried frame yields rather than winning by one input.
    expect(routeSnapGuides('station', [guideAt(30)])).toBe(false);
    expect(useDragFrame.getState().frame).toBeNull();
    g.commit();
  });
});

describe('input atomicity', () => {
  it('a multi-write input lands as ONE frame, snapshotted at end of handler', async () => {
    // A single pointermove often writes more than once (moveStation then
    // translateSiblings; bindStationToCircle then the slide) and publishes
    // its guides AFTER the writes. A frame sent synchronously from inside
    // the FIRST write would paint a half-applied input with the previous
    // input's guides — an arrangement the user never made.
    const g = await armMidGesture(10);
    fake.deliver(resultFor(fake.frames()[0], holesOf('l1', 100))); // pipeline idle
    const before = fake.frames().length;
    const guides: SnapGuide[] = [{ from: { x: 2, y: 0 }, to: { x: 2, y: 100 } }];

    // One input: two writes, then the guide publish.
    useDoc.getState().moveStation('s1', 30, 0);
    useDoc.getState().moveStation('s1', 40, 0);
    routeSnapGuides('station', guides);
    // Nothing may cross mid-handler.
    expect(fake.frames().length).toBe(before);

    await flushMicrotasks();
    expect(fake.frames().length).toBe(before + 1);
    const f = fake.frames()[before];
    // The frame carries the input's FINAL state, not the first write's.
    expect(f.sync?.stations?.['s1'].x).toBe(40);
    fake.deliver(resultFor(f, holesOf('l1', 200)));
    expect(useDragFrame.getState().frame?.guides).toEqual(guides);
    expect(useRenderDoc.getState().stations['s1'].x).toBe(40);
    g.commit();
  });
});

describe('worker warm-up at gesture begin', () => {
  const seedAssignment = () => {
    useDoc.setState({
      ...useDoc.getState(),
      regionAssignments: { r1: { id: 'r1', lineId: 'l1', lines: ['l1'], anchors: [] } },
    });
  };

  it('a deferPersist begin on a regions map boots and syncs the worker before any arm', () => {
    seedAssignment();
    expect(created).toBe(0);
    const g = beginHistoryGroup({ deferPersist: true });
    // Boot starts at pointerdown: worker exists, mirror synced, no frame.
    expect(created).toBe(1);
    expect(fake.posts.some((p) => p.kind === 'sync')).toBe(true);
    expect(fake.frames().length).toBe(0);
    g.commit();
  });

  it('a begin-warmed worker still gets the boot-sized budget for its first frame', async () => {
    // The trap: after warm-at-begin, `worker` and `lastPosted` are both
    // non-null at the first send — but the worker may STILL be compiling
    // wasm. Coldness is per-worker (until its first accepted RESULT), not
    // per-mirror.
    vi.useFakeTimers();
    try {
      seedAssignment();
      const g = await armMidGesture(10);
      expect(created).toBe(1); // the begin-created worker, not a new one
      vi.advanceTimersByTime(4000);
      expect(regionPipelineStatus().armed).toBe(true);
      expect(fake.terminated).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(regionPipelineStatus().armed).toBe(false);
      g.commit();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('snap guides — clears and carry-forward', () => {
  const guideAt = (x: number): SnapGuide => ({ from: { x, y: 0 }, to: { x, y: 100 } });

  it('a clear published while armed reaches the next frame (no stale halo)', async () => {
    // The stale-guide strand: a hook that guards its clear on FROZEN local
    // state would skip publishing [] after an unsnap (Shift, ring capture),
    // and every later frame would keep painting the last guides. The routed
    // clear must land in the pending cargo.
    const g = await armMidGesture(10);
    expect(routeSnapGuides('station', [guideAt(1)])).toBe(true);
    useDoc.getState().moveStation('s1', 20, 0); // pending write behind frame 1
    // The unsnap path publishes an unconditional clear.
    expect(routeSnapGuides('station', [])).toBe(true);
    useDoc.getState().moveStation('s1', 30, 0);

    fake.deliver(resultFor(fake.frames()[0], holesOf('l1', 100)));
    fake.deliver(resultFor(fake.frames()[1], holesOf('l1', 200)));
    expect(useDragFrame.getState().frame?.guides).toEqual([]);
    g.commit();
  });

  it('guides published just before arming ride the FIRST frame (no blink-out)', async () => {
    // At rest the routed setter also records, so arming inherits the guides
    // the canvas is already showing instead of blanking them for one
    // compute-frame.
    const preArm = [guideAt(5)];
    expect(routeSnapGuides('station', preArm)).toBe(false); // unarmed: hook keeps local state too
    const g = await armMidGesture(10);
    fake.deliver(resultFor(fake.frames()[0], holesOf('l1', 100)));
    expect(useDragFrame.getState().frame?.guides).toEqual(preArm);
    g.commit();
  });
});

describe('cold-boot watchdog', () => {
  it("the first frame's budget covers worker boot + wasm + a full build", async () => {
    vi.useFakeTimers();
    try {
      const g = await armMidGesture(10);
      expect(regionPipelineStatus().armed).toBe(true);
      // 4s in: a cold first frame (worker fetch + wasm compile + full mirror
      // + full hub build on a slow machine) must NOT be declared dead by the
      // warm-frame watchdog.
      vi.advanceTimersByTime(4000);
      expect(regionPipelineStatus().armed).toBe(true);
      expect(fake.terminated).toBe(false);
      // But the cold budget is still a budget.
      vi.advanceTimersByTime(1500);
      expect(regionPipelineStatus().armed).toBe(false);
      expect(fake.terminated).toBe(true);
      g.commit();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mirror warmth at rest', () => {
  it('non-grouped doc changes post diffs; grouped writes wait for the exit', async () => {
    // Create the worker via one armed gesture.
    (await armMidGesture(10)).commit();
    const before = fake.posts.length;

    // An at-rest edit: one sync carrying just the changed record.
    useDoc.getState().moveStation('s1', 77, 0);
    const syncs = fake.posts.slice(before).filter((p) => p.kind === 'sync');
    expect(syncs).toHaveLength(1);
    expect(syncs[0].kind === 'sync' && syncs[0].sync.stations?.['s1'].x).toBe(77);

    // A grouped (but unarmed) gesture: no per-frame posts; the exit resyncs.
    const mid = fake.posts.length;
    const g = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation('s1', 80, 0);
    useDoc.getState().moveStation('s1', 90, 0);
    expect(fake.posts.slice(mid).filter((p) => p.kind === 'sync')).toHaveLength(0);
    g.commit();
    const after = fake.posts.slice(mid).filter((p) => p.kind === 'sync');
    expect(after).toHaveLength(1);
    expect(after[0].kind === 'sync' && after[0].sync.stations?.['s1'].x).toBe(90);
  });
});
