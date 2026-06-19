import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewport, type ViewportApi } from './useViewport';
import { useViewportStore } from '../../state/viewportStore';
import { dragState } from '../../state/store';
import { fakeSvgRef, pointerEvent, wheelEvent } from '../../test/interaction';

type Result = { current: ViewportApi };

const down = (r: Result, e: React.PointerEvent) => act(() => r.current.startPan(e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));
const wheel = (r: Result, e: React.WheelEvent) => act(() => r.current.onWheel(e));

beforeEach(() => {
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  dragState.suppressClick = false;
});

// 800×600 canvas at the top-left of the screen; the effect reads the size off
// the fake parentElement on mount.
function render() {
  const { ref, svg } = fakeSvgRef({ width: 800, height: 600 });
  const { result } = renderHook(() => useViewport(ref));
  return { result, ref, svg };
}

describe('useViewport — sizing + screenToWorld', () => {
  it('initializes size from the parent element on mount', () => {
    const { result } = render();
    expect(result.current.size).toEqual({ w: 800, h: 600 });
  });

  it('maps the screen center to the viewport center', () => {
    const { result } = render();
    // zoom 1, centered on world origin → screen (400,300) is world (0,0).
    expect(result.current.screenToWorld(400, 300)).toEqual({ x: 0, y: 0 });
  });

  it('accounts for zoom in screenToWorld', () => {
    useViewportStore.setState({ x: 0, y: 0, zoom: 2 });
    const { result } = render();
    // vbW = 800/2 = 400; relX=600/800=0.75 → x = -200 + 0.75*400 = 100.
    // vbH = 600/2 = 300; relY=300/600=0.5 → y = -150 + 0.5*300 = 0.
    expect(result.current.screenToWorld(600, 300)).toEqual({ x: 100, y: 0 });
  });
});

describe('useViewport — wheel zoom', () => {
  it('writes the zoomed viewBox imperatively and defers the store commit', () => {
    const { result, svg } = render();
    const vbBefore = svg.getAttribute('viewBox');
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    // viewBox reflects the zoom immediately...
    expect(svg.getAttribute('viewBox')).not.toBe(vbBefore);
    // ...but the store waits for the gesture to settle (no per-tick re-render).
    expect(result.current.viewport.zoom).toBe(1);
  });

  it('commits the zoom by exp(-deltaY*0.0015) once the wheel settles', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      expect(result.current.viewport.zoom).toBe(1); // not yet
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.15), 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('compounds rapid ticks against the live zoom before committing', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      act(() => vi.runAllTimers());
      // Two ticks compound: exp(0.15)^2 = exp(0.30), not exp(0.15).
      expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.3), 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the world point under the cursor fixed once the zoom settles', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      const cx = 600;
      const cy = 200;
      const before = result.current.screenToWorld(cx, cy);
      wheel(result, wheelEvent({ clientX: cx, clientY: cy, deltaY: -120 }));
      act(() => vi.runAllTimers());
      const after = result.current.screenToWorld(cx, cy);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps zoom to a max of 64', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100000 }));
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBe(64);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps zoom to a min of 0.1', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: 100000 }));
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBe(0.1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useViewport — panning', () => {
  it('starts a pan on the left button and captures the pointer', () => {
    const { result, svg } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    expect(result.current.panning).toBe(true);
    expect(svg.hasPointerCapture(1)).toBe(true);
  });

  it('ignores non-left/middle buttons', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 2 }));
    expect(result.current.panning).toBe(false);
  });

  it('translates the viewport by the screen delta divided by zoom (committed on pointer-up)', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    up(result, pointerEvent({ clientX: 150, clientY: 130 }));
    // dx = 50/1, dy = 30/1 → viewport center moves opposite the drag.
    expect(result.current.viewport.x).toBe(-50);
    expect(result.current.viewport.y).toBe(-30);
  });

  it('writes the viewBox imperatively during a move, deferring the store commit to pointer-up', () => {
    const { result, svg } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    // viewBox tracks the pan immediately: next viewport {-50,-30,1} →
    // vb {-450,-330,800,600}.
    expect(svg.getAttribute('viewBox')).toBe('-450 -330 800 600');
    // ...but the store stays put until pointer-up (no per-move re-render).
    expect(result.current.viewport.x).toBe(0);
    expect(result.current.viewport.y).toBe(0);
    up(result, pointerEvent({ clientX: 150, clientY: 130 }));
    expect(result.current.viewport.x).toBe(-50);
  });

  it('adopts an un-committed wheel zoom as the pan base (zoom, then pan before settle)', () => {
    const { result } = render();
    // Zoom in — pending, not yet committed to the store.
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    expect(result.current.viewport.zoom).toBe(1);
    // Grab-pan before the settle fires.
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 100 }));
    up(result, pointerEvent({ clientX: 150, clientY: 100 }));
    // The commit carries BOTH the zoom (not lost) and a pan scaled by that zoom.
    expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.15), 5);
    expect(result.current.viewport.x).toBeCloseTo(-50 / Math.exp(0.15), 5);
  });

  it('does not suppress the click for a sub-threshold pan', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 102, clientY: 102 })); // ~2.8px
    up(result, pointerEvent({ clientX: 102, clientY: 102 }));
    expect(dragState.suppressClick).toBe(false);
  });

  it('suppresses the click and releases capture after a real pan', () => {
    const { result, svg } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 200, clientY: 100 }));
    up(result, pointerEvent({ clientX: 200, clientY: 100 }));
    expect(dragState.suppressClick).toBe(true);
    expect(result.current.panning).toBe(false);
    expect(svg.hasPointerCapture(1)).toBe(false);
  });
});
