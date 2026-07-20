import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLineTagDrag } from './useLineTagDrag';
import { useDoc, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeLine, makeStation, makeStop, stationWithStop } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent, dispatchWindowPointer } from '../../test/interaction';
import type { LineId, StationId } from '../../model/types';

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

// A horizontal A—B segment on line L1, with one text tag anchored 20 units from
// the 'from' (A) end. The hook converts the cursor via the injected
// screenToWorld; render() passes an identity map, so a pointer at screen (x, y)
// projects onto the segment at world (x, y).
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

const identityScreenToWorld = (mx: number, my: number) => ({ x: mx, y: my });

function render(zoom = 1) {
  const { ref, svg } = fakeSvgRef();
  const { result } = renderHook(() => useLineTagDrag(ref, zoom, identityScreenToWorld));
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

  it('neighbor-snaps by default (no snap toggle needed), drawing a labeled guide', () => {
    // Restored always-on behavior: a tag lines up with its neighbors without
    // the "Snap to all" pref, which defaults off (beforeEach resets to it).
    addNeighborAt(50);
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

  it('snaps to a neighbor tag on an ADJACENT interlined line', () => {
    // The reported scenario: two interlined lines share one two-stripe band
    // (stops 14 apart). Dragging L1's tag near L2's snaps it to sit directly
    // across the corridor — same cross-section, one stripe-gap away.
    const stops = () => [
      makeStop('L1' as LineId, { row: 0, col: 0, orientation: 'auto-horizontal' }),
      makeStop('L2' as LineId, { row: 1, col: 0, orientation: 'auto-horizontal' }),
    ];
    useDoc.setState({
      ...useDoc.getState(),
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }),
        L2: makeLine({ id: 'L2' as LineId, stations: ['A', 'B'] as StationId[] }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
      stations: {
        A: makeStation({ id: 'A' as StationId, x: 0, y: 0, stops: stops() }),
        B: makeStation({ id: 'B' as StationId, x: 200, y: 0, stops: stops() }),
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
        N: {
          id: 'N',
          lineId: 'L2' as LineId,
          fromStationId: 'A' as StationId,
          toStationId: 'B' as StationId,
          anchorEnd: 'from',
          distance: 50,
          orientation: 0,
        },
      },
    });
    useDoc.temporal.getState().clear();
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() => dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0 }));

    // Snaps along the corridor to N's cross-section (distance 50 from A). The
    // projection's ternary refine leaves ~1e-4 residue, so 3 dp not 5.
    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(50, 3);
    // Guide spans the two stripes (14 apart), both at the same along-position.
    expect(result.current.lineTagSnapGuides).toHaveLength(1);
    const g = result.current.lineTagSnapGuides[0];
    expect(g.from.x).toBeCloseTo(g.to.x, 3);
    expect(g.label).toBe('14');
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it('Shift bypasses the neighbor snap mid-drag', () => {
    addNeighborAt(50);
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    act(() => dispatchWindowPointer('pointermove', { clientX: 44, clientY: 0, shiftKey: true }));

    expect(useDoc.getState().lineTags['T'].distance).toBeCloseTo(44, 5);
    dispatchWindowPointer('pointerup', { clientX: 44, clientY: 0 });
  });

  it('the engage radius is constant in screen px (tolerance ÷ zoom)', () => {
    addNeighborAt(50);
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

  it('can drag a tag onto a loop-filling segment, not just consecutive display pairs', () => {
    // Triangle loop A-B-C-A. The wrap edge A|C is a real segment but NOT a
    // consecutive pair in the display order [A, B, C], so the old candidate set
    // (built from consecutive stations) skipped it and the tag could never land
    // there. A|C is the vertical corridor from A(0,0) down to C(0,100).
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({
          id: 'L1' as LineId,
          stations: ['A', 'B', 'C'] as StationId[],
          edges: ['A|B', 'B|C', 'A|C'],
        }),
      },
      lineOrder: ['L1' as LineId],
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 100, y: 0 }),
        C: stationWithStop('C' as StationId, 'L1' as LineId, { x: 0, y: 100 }),
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
    const { result } = render();
    result.current.onStartDrag('T', pointerEvent({ clientX: 20, clientY: 0 }));
    // Drag to the middle of the A|C corridor (world (0, 50)).
    dispatchWindowPointer('pointermove', { clientX: 0, clientY: 50 });

    const tag = useDoc.getState().lineTags['T'];
    expect(tag.fromStationId).toBe('A');
    expect(tag.toStationId).toBe('C');
    // Landed on the A|C corridor, near its middle.
    expect(tag.distance).toBeGreaterThan(30);
    dispatchWindowPointer('pointerup', { clientX: 0, clientY: 50 });
  });
});
