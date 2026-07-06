import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefObject } from 'react';
import {
  DRAG_MOVE_THRESHOLD,
  finishDrag,
  releaseDragCapture,
  trackDragMove,
  type DragThreshold,
} from './dragGesture';
import { dragState } from '../../state/store';

// A minimal SVG stand-in that records pointer-capture calls. The drag helpers
// only ever touch set/releasePointerCapture, so this is enough to drive them.
function fakeSvgRef(): {
  ref: RefObject<SVGSVGElement | null>;
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
} {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  const el = { setPointerCapture, releasePointerCapture } as unknown as SVGSVGElement;
  return { ref: { current: el }, setPointerCapture, releasePointerCapture };
}

beforeEach(() => {
  dragState.suppressClick = false;
});

describe('trackDragMove', () => {
  it('does not flip `moved` or suppress clicks below the threshold', () => {
    const { ref, setPointerCapture } = fakeSvgRef();
    const state: DragThreshold = { startMX: 0, startMY: 0, moved: false };
    const r = trackDragMove(state, { clientX: DRAG_MOVE_THRESHOLD, clientY: 0, pointerId: 7 }, ref);
    expect(r.moved).toBe(false);
    expect(state.moved).toBe(false);
    expect(dragState.suppressClick).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('flips `moved`, suppresses clicks, and captures the pointer past the threshold', () => {
    const { ref, setPointerCapture } = fakeSvgRef();
    const state: DragThreshold = { startMX: 0, startMY: 0, moved: false };
    const r = trackDragMove(
      state,
      { clientX: DRAG_MOVE_THRESHOLD + 1, clientY: 0, pointerId: 7 },
      ref,
    );
    expect(r).toEqual({ moved: true, dxScreen: DRAG_MOVE_THRESHOLD + 1, dyScreen: 0 });
    expect(state.moved).toBe(true);
    expect(dragState.suppressClick).toBe(true);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });
});

describe('releaseDragCapture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The load-bearing behavior: the suppress flag must survive the synchronous
  // return (so the browser's trailing synthesized click is still swallowed) and
  // only clear on the next macrotask. A synchronous clear would leak that click.
  it('releases capture immediately but defers the suppressClick clear a macrotask', () => {
    const { ref, releasePointerCapture } = fakeSvgRef();
    dragState.suppressClick = true;

    releaseDragCapture({ pointerId: 3 }, ref);

    // Synchronously: capture released, but the flag is still up.
    expect(releasePointerCapture).toHaveBeenCalledWith(3);
    expect(dragState.suppressClick).toBe(true);

    // After the deferred macrotask: cleared.
    vi.runAllTimers();
    expect(dragState.suppressClick).toBe(false);
  });
});

describe('finishDrag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits and clears suppression on the next tick when the gesture moved', () => {
    const { ref } = fakeSvgRef();
    const commit = vi.fn();
    const cancel = vi.fn();
    dragState.suppressClick = true;

    const committed = finishDrag(
      { moved: true, history: { commit, cancel } },
      { pointerId: 1 },
      ref,
    );

    expect(committed).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    // Still suppressed synchronously (trailing click not yet fired)...
    expect(dragState.suppressClick).toBe(true);
    vi.runAllTimers();
    // ...cleared after the deferred macrotask.
    expect(dragState.suppressClick).toBe(false);
  });

  it('force-commits a gesture that never moved (e.g. polygon edge-add)', () => {
    const { ref } = fakeSvgRef();
    const commit = vi.fn();
    const cancel = vi.fn();

    const committed = finishDrag(
      { moved: false, forceCommit: true, history: { commit, cancel } },
      { pointerId: 1 },
      ref,
    );

    expect(committed).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels a pure click and leaves the suppress flag untouched', () => {
    const { ref } = fakeSvgRef();
    const commit = vi.fn();
    const cancel = vi.fn();
    // A gesture that reaches this branch never moved, so trackDragMove never set
    // the flag; finishDrag must not clear a flag some other gesture may own.
    dragState.suppressClick = true;

    const committed = finishDrag(
      { moved: false, history: { commit, cancel } },
      { pointerId: 1 },
      ref,
    );

    expect(committed).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(dragState.suppressClick).toBe(true);
  });
});
