// The point snapper every drag site shares. What is worth pinning here is the
// rule the sites used to restate one by one: the engage radius is a constant
// number of SCREEN pixels, so the world-space radius shrinks as you zoom in.
// Before this hook only the polygon drag and the bullet path guarded it —
// nothing covered the svg-image or label consumers, which could have drifted to
// a raw world-unit tolerance without a single test going red.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDragSnap } from './useDragSnap';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_SNAP_MODES, SNAP_PERP_TOLERANCE } from '../../geometry/snap';

// One target at the origin; "Snap to all" aligns to it along both cardinals.
const TARGET = [{ x: 0, y: 0 }];

beforeEach(() => {
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'all', grid: 'off' } });
  useViewportStore.setState({ gridSize: 10 });
});

describe('useDragSnap', () => {
  it('engages within a constant SCREEN distance — zooming in shrinks the world radius', () => {
    // 7 world units off the target's vertical axis, at both zooms.
    const proposed = { x: 7, y: 200 };

    // Zoom 1: radius is the full SNAP_PERP_TOLERANCE (10) → 7 is inside.
    const at1 = renderHook(() => useDragSnap(1)).result.current;
    expect(at1.snapPoint(proposed, { allTargets: TARGET }).x).toBeCloseTo(0, 9);

    // Zoom 2: the same 10 screen px is 5 world units → 7 is outside, untouched.
    const at2 = renderHook(() => useDragSnap(2)).result.current;
    const out = at2.snapPoint(proposed, { allTargets: TARGET });
    expect(out.x).toBeCloseTo(7, 9);
    expect(out.guides).toHaveLength(0);

    // Zoom 0.5: 20 world units of radius — a point 15 out now catches.
    const at05 = renderHook(() => useDragSnap(0.5)).result.current;
    expect(at05.snapPoint({ x: 15, y: 200 }, { allTargets: TARGET }).x).toBeCloseTo(0, 9);

    // The three radii are exactly SNAP_PERP_TOLERANCE / zoom, not a coincidence
    // of the numbers above.
    expect(SNAP_PERP_TOLERANCE).toBe(10);
  });

  it('reads the LIVE grid size, so a toolbar change lands on the next snap', () => {
    const api = renderHook(() => useDragSnap(1));
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'off', grid: 'both' } });

    useViewportStore.setState({ gridSize: 10 });
    api.rerender();
    expect(api.result.current.snapPoint({ x: 26, y: 0 }, { allTargets: [] }).x).toBeCloseTo(30, 9);

    useViewportStore.setState({ gridSize: 20 });
    api.rerender();
    expect(api.result.current.snapPoint({ x: 26, y: 0 }, { allTargets: [] }).x).toBeCloseTo(20, 9);
  });

  it('passes the line pool and the single-DOF lock through', () => {
    useSnapPrefs.setState({
      modes: { ...DEFAULT_SNAP_MODES, line: true, all: 'off', grid: 'off' },
    });
    const api = renderHook(() => useDragSnap(1)).result.current;

    // Line mode aligns to the line pool, not the (here empty) all pool.
    expect(api.snapPoint({ x: 4, y: 200 }, { allTargets: [], lineTargets: TARGET }).x).toBeCloseTo(
      0,
      9,
    );

    // 'y' constrains to snaps that move world Y, so the vertical alignment that
    // would have locked X is not considered at all.
    const locked = api.snapPoint(
      { x: 4, y: 200 },
      { allTargets: [], lineTargets: TARGET, constrain: 'y' },
    );
    expect(locked.x).toBeCloseTo(4, 9);
    expect(locked.guides).toHaveLength(0);
  });
});
