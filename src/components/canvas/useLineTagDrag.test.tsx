import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLineTagDrag } from './useLineTagDrag';
import { useDoc, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeLine, stationWithStop } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent, dispatchWindowPointer } from '../../test/interaction';
import type { LineId, StationId } from '../../model/types';

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

// A horizontal A—B segment on line L1, with one text tag anchored 20 units from
// the 'from' (A) end. The fake svg uses an identity CTM, so a pointer at screen
// (x, y) projects onto the segment at world (x, y).
beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }) },
    lineOrder: ['L1' as LineId],
    stations: {
      A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
      B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 100, y: 0 }),
    },
    lineTags: {
      T: {
        id: 'T',
        lineId: 'L1' as LineId,
        fromStationId: 'A' as StationId,
        toStationId: 'B' as StationId,
        anchorEnd: 'from',
        distance: 20,
        orientation: 0,
      },
    },
  });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
  setModes({});
});

// The hook wires move/up onto window and only unregisters on pointerup. End any
// in-flight gesture so a failed assertion mid-drag can't leak a window listener
// into the next test.
afterEach(() => {
  dispatchWindowPointer('pointerup', { clientX: 0, clientY: 0 });
});

function render(zoom = 1) {
  const { ref, svg } = fakeSvgRef();
  const { result } = renderHook(() => useLineTagDrag(ref, zoom));
  return { result, svg };
}

// A second tag on the same corridor, `distance` units from the A end — the
// neighbor the dragged tag may snap to.
const addNeighborAt = (distance: number) =>
  useDoc.setState({
    ...useDoc.getState(),
    lineTags: {
      ...useDoc.getState().lineTags,
      N: {
        id: 'N',
        lineId: 'L1' as LineId,
        fromStationId: 'A' as StationId,
        toStationId: 'B' as StationId,
        anchorEnd: 'from',
        distance,
        orientation: 0,
      },
    },
  });

describe('useLineTagDrag', () => {
  it('projects the cursor onto the segment and re-anchors the tag', () => {
    const { result, svg } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    dispatchWindowPointer('pointermove', { clientX: 50, clientY: 0 }); // mid-segment

    const tag = useDoc.getState().lineTags['T'];
    expect(tag.fromStationId).toBe('A');
    expect(tag.toStationId).toBe('B');
    // Re-anchored to the exact projected arc-length: the cursor at world x=50
    // projects to the segment midpoint, 50 units from the 'from' (A at x=0) end
    // of the 100-unit straight stripe. The old >30 && <70 window let a ~15-unit
    // anchor error slip through.
    expect(tag.distance).toBeCloseTo(50, 0);
    expect(dragState.suppressClick).toBe(true);
    expect(svg.hasPointerCapture(1)).toBe(true);

    dispatchWindowPointer('pointerup', { clientX: 50, clientY: 0 });
  });

  it('does not move the tag until the pointer passes the 4px threshold', () => {
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    dispatchWindowPointer('pointermove', { clientX: 22, clientY: 0 }); // 2px
    expect(useDoc.getState().lineTags['T'].distance).toBe(20);
    expect(dragState.suppressClick).toBe(false);
    dispatchWindowPointer('pointerup', { clientX: 22, clientY: 0 });
  });

  it('cancels the history group on a click with no drag', () => {
    const before = historyDepth();
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    dispatchWindowPointer('pointerup', { clientX: 21, clientY: 0 }); // no move
    expect(historyDepth()).toBe(before);
    expect(useDoc.getState().lineTags['T'].distance).toBe(20);
  });

  it('commits one history entry and releases capture after a real drag', () => {
    const before = historyDepth();
    const { result, svg } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    dispatchWindowPointer('pointermove', { clientX: 60, clientY: 0 });
    dispatchWindowPointer('pointerup', { clientX: 60, clientY: 0 });
    expect(historyDepth()).toBe(before + 1);
    expect(svg.hasPointerCapture(1)).toBe(false);
  });

  it("neighbor snap engages only with 'Snap to all' on, drawing a labeled guide", () => {
    addNeighborAt(50);
    setModes({ all: 'all' });
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() => dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0 }));

    // 6 inside the 10-unit tolerance → adopts the neighbor's position.
    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(50, 5);
    expect(result.current.lineTagSnapGuides).toHaveLength(1);
    // Same-stripe neighbor: the guide collapses onto the shared point (50, 0).
    expect(result.current.lineTagSnapGuides[0].from.x).toBeCloseTo(50, 3);
    expect(result.current.lineTagSnapGuides[0].to.x).toBeCloseTo(50, 3);
    expect(result.current.lineTagSnapGuides[0].label).toBe('0');
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it("does NOT neighbor-snap with 'Snap to all' off (the default)", () => {
    addNeighborAt(50);
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() => dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0 }));

    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(44, 5);
    expect(result.current.lineTagSnapGuides).toHaveLength(0);
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it('Shift bypasses the neighbor snap mid-drag', () => {
    addNeighborAt(50);
    setModes({ all: 'all' });
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() =>
      dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0, shiftKey: true }),
    );

    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(44, 5);
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it('the engage radius is constant in screen px (tolerance ÷ zoom)', () => {
    addNeighborAt(50);
    setModes({ all: 'all' });
    // Zoom 4 → world tolerance 10/4 = 2.5; a 6-unit gap must NOT snap.
    const { result } = render(4);
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() => dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0 }));

    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(44, 5);
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it('rolls back and disarms on a browser pointercancel', () => {
    // A pointercancel (pen palm rejection, window switch, capture loss) ends
    // the gesture with NO pointerup. The drag must revert its live moveLineTag
    // writes, resume history recording, and disarm — a stray later move must
    // not keep dragging a button-less tag.
    const before = historyDepth();
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    dispatchWindowPointer('pointermove', { clientX: 40, clientY: 0 });
    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(40, 0);

    dispatchWindowPointer('pointercancel', { clientX: 40, clientY: 0 });
    expect(useDoc.getState().lineTags['T'].distance).toBe(20); // reverted
    expect(historyDepth()).toBe(before); // nothing committed
    expect(useDoc.temporal.getState().isTracking).toBe(true); // recording resumed

    dispatchWindowPointer('pointermove', { clientX: 90, clientY: 0 });
    expect(useDoc.getState().lineTags['T'].distance).toBe(20); // disarmed
  });
});
