import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { snapPlacement, usePlacementDispatch } from './usePlacementDispatch';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { makeLineCircle } from '../../test/fixtures';
import { pointAtAngle } from '../../geometry/lineCircle';
import { pointerEvent } from '../../test/interaction';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
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
  useSelection.getState().setUiMode({ kind: 'idle' });
  useViewportStore.setState({ showLineCircles: true });
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

describe('snapPlacement — a hidden ring cannot capture', () => {
  // Ring capture reads doc.lineCircles straight off the doc, so hiding the
  // guides does not remove it: a station dropped near an INVISIBLE rim would
  // snap onto it and `bindDroppedStation` would bind it there, leaving the map
  // attached to a guide the user cannot see and never chose.
  it('leaves the drop where the engine puts it while Line circles are hidden', () => {
    useViewportStore.setState({ showLineCircles: false });
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 }, // 5 world units outside the rim — inside tolerance
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    // Not projected onto the rim at x=170.
    expect(Math.hypot(r.x - 100, r.y - 100)).not.toBeCloseTo(70, 6);
  });

  it('captures again the moment the rings come back', () => {
    useViewportStore.setState({ showLineCircles: false });
    const hidden = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 },
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    useViewportStore.setState({ showLineCircles: true });
    const shown = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 },
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(shown.x).toBeCloseTo(170, 9);
    expect(shown.x).not.toBeCloseTo(hidden.x, 6);
  });

  it('captures while the placing-line-circle mode has the rings revealed', () => {
    // The reveal is the point of kindVisibleNow: rings are on screen during
    // their own placing mode, so they must still capture.
    useViewportStore.setState({ showLineCircles: false });
    useSelection.getState().setUiMode({ kind: 'placing-line-circle', center: null });
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 },
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(r.x).toBeCloseTo(170, 9);
  });
});

describe('snapPlacement — cardinal magnetism on the rim', () => {
  const CARDINALS = { ...DEFAULT_SNAP_MODES, circle: true };
  const RIM = { x: 100, y: 100, radius: 70 };
  // Cursor points are derived, not tabulated: a point 5 units OUTSIDE the rim
  // at polar angle θ (captured, since 5 < 10) whose projection therefore lands
  // at exactly θ on the rim.
  const outside = (theta: number) => pointAtAngle({ ...RIM, radius: 75 }, theta);
  const onRim = (theta: number) => pointAtAngle(RIM, theta);
  // 0.06 rad shy of due west = 4.2 units of arc, inside the 10-unit window.
  const NEAR_WEST = outside(Math.PI - 0.06);
  const place = (world: { x: number; y: number }, modes = CARDINALS, shift = false) =>
    snapPlacement({ kind: 'placing-station' }, world, shift, modes, 25, 1);

  it('pulls a placed station onto the 9 o’clock cardinal', () => {
    const r = place(NEAR_WEST);
    expect(r.x).toBeCloseTo(30, 6);
    expect(r.y).toBeCloseTo(100, 6);
  });

  it('stops at the plain rim seat when cardinals are off', () => {
    const r = place(NEAR_WEST, DEFAULT_SNAP_MODES);
    const want = onRim(Math.PI - 0.06);
    expect(r.x).toBeCloseTo(want.x, 9);
    expect(r.y).toBeCloseTo(want.y, 9);
  });

  it('applies to the Edit Stops create-click too, not just placing-station', () => {
    const r = snapPlacement(
      { kind: 'appending-to-line', lineId: 'L1', cursor: null },
      NEAR_WEST,
      false,
      CARDINALS,
      25,
      1,
    );
    expect(r.x).toBeCloseTo(30, 6);
    expect(r.y).toBeCloseTo(100, 6);
  });

  it('leaves a rim seat far from every cardinal alone', () => {
    // θ = 0.4 rad — 27 units of arc from the nearest cardinal.
    const r = place(outside(0.4));
    const want = onRim(0.4);
    expect(r.x).toBeCloseTo(want.x, 9);
    expect(r.y).toBeCloseTo(want.y, 9);
  });

  it('Shift still bypasses with cardinals on', () => {
    const r = place(NEAR_WEST, CARDINALS, true);
    expect(r.x).toBe(NEAR_WEST.x);
    expect(r.y).toBe(NEAR_WEST.y);
  });

  it('keeps the seat exactly on the rim, so the drop still binds', () => {
    // bindDroppedStation re-captures at a 0.5-unit tolerance; a cardinal pull
    // travels ALONG the rim, so that recognition must be untouched.
    const r = place(NEAR_WEST);
    expect(Math.hypot(r.x - 100, r.y - 100)).toBeCloseTo(70, 9);
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
