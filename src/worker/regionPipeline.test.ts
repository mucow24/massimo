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
