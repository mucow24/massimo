import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { snapPlacement, usePlacementDispatch } from './usePlacementDispatch';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { makeLineCircle } from '../../test/fixtures';
import { pointerEvent } from '../../test/interaction';
import { useSnapPrefs } from '../../state/snapPrefs';
import type { ViewportApi } from './useViewport';

// Identity screen→world so a click at (cx, cy) lands at world (cx, cy).
const fakeView = {
  screenToWorld: (x: number, y: number) => ({ x, y }),
  viewport: { x: 0, y: 0, zoom: 1 },
} as ViewportApi;

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) },
  });
  useDoc.temporal.getState().clear();
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'off' } });
  useSelection.getState().clearAllSelections();
});

describe('snapPlacement — line-circle rim capture', () => {
  it('projects a placing-station drop within tolerance onto the rim', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 }, // 5 world units outside the rim
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(r.x).toBeCloseTo(170, 9);
    expect(r.y).toBeCloseTo(100, 9);
  });

  it('leaves a drop outside tolerance to the normal engine', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 200, y: 100 }, // 30 outside — well past capture
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(Math.hypot(r.x - 100, r.y - 100)).toBeGreaterThan(70 + 10);
  });

  it('Shift bypasses the rim capture like every other snap', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 },
      true,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(r.x).toBe(175);
    expect(r.y).toBe(100);
  });
});

describe('two-click line-circle placement', () => {
  it('first click arms the center, second sets the radius from the cursor distance', () => {
    useSelection.getState().setUiMode({ kind: 'placing-line-circle', center: null });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 300, clientY: 300 }));
    });
    // No circle yet; the mode carries the armed center.
    expect(Object.keys(useDoc.getState().lineCircles)).toHaveLength(1); // just c1
    const mode = useSelection.getState().uiMode;
    expect(mode).toEqual({ kind: 'placing-line-circle', center: { x: 300, y: 300 } });

    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 350, clientY: 300 }));
    });
    const circles = Object.values(useDoc.getState().lineCircles).filter((c) => c.id !== 'c1');
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({ x: 300, y: 300, radius: 50 });
    // Exited to idle with the new circle selected.
    expect(useSelection.getState().uiMode).toEqual({ kind: 'idle' });
    expect(useSelection.getState().selectedLineCircleIds).toEqual([circles[0].id]);
  });
});
