import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLineTagDrag } from './useLineTagDrag';
import { useDoc, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLine, stationWithStop } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent, dispatchWindowPointer } from '../../test/interaction';
import type { LineId, StationId } from '../../model/types';

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
});

// The hook wires move/up onto window and only unregisters on pointerup. End any
// in-flight gesture so a failed assertion mid-drag can't leak a window listener
// into the next test.
afterEach(() => {
  dispatchWindowPointer('pointerup', { clientX: 0, clientY: 0 });
});

function render() {
  const { ref, svg } = fakeSvgRef();
  const { result } = renderHook(() => useLineTagDrag(ref));
  return { result, svg };
}

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
});
