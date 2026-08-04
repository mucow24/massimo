import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useItemDrag, type ItemDragApi } from '../../components/canvas/useItemDrag';
import { useDoc, useSelection } from '../../state/store';
import { clearHistory } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { stationWithStop, makeLine } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { StationId } from '../../model/types';

type Result = { current: ItemDragApi };
const bulletDown = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onBulletPointerDown(id, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
  });
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: true, all: 'off', grid: 'off' } });
  useViewportStore.setState({ showNetwork: true });

  // Station A: auto-vertical stop on L1 at (0,0) → a vertical snap axis at x=0.
  // Bullet b1 is bound to L1, so the bound-bullet branch of useItemDrag runs the
  // station snap engine in bullet mode against A.
  useDoc.setState({
    ...useDoc.getState(),
    lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
    lineOrder: ['L1'],
    stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
    routeBullets: {
      b1: { id: 'b1', x: 50, y: 50, rotation: 0, lineId: 'L1', shape: 'circle', size: 8 },
    },
  });
});

afterEach(() => {
  useViewportStore.setState({ showNetwork: true });
});

// Drag b1 from world (50,50) to world (4,50) at zoom 1: perp distance to the
// axis x=0 is 4, inside the 10-world-unit tolerance.
function dragBulletTo4() {
  const { ref } = fakeSvgRef();
  const { result } = renderHook(() => useItemDrag(ref, 1, false));
  bulletDown(result, 'b1', pointerEvent({ clientX: 200, clientY: 200 }));
  move(result, pointerEvent({ clientX: 154, clientY: 200 }));
  return result;
}

describe('bound route bullet vs the lines/stations toggle', () => {
  it('positive control: with the network SHOWN the bullet snaps onto the stop axis', () => {
    const result = dragBulletTo4();
    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(0, 5);
    expect(result.current.itemSnapGuides.length).toBeGreaterThan(0);
  });

  it('does not snap a bound bullet to a station the network toggle has hidden', () => {
    // Station A is not rendered (StationView returns null while showNetwork is
    // false) but the route bullet still is, so it stays draggable. Nothing on
    // the canvas to align to → the bullet must follow the cursor, and no guide
    // may be drawn to the blank patch where A used to be. Same rule
    // liveAlignTargets enforces for every other decoration drag.
    useViewportStore.setState({ showNetwork: false });
    const result = dragBulletTo4();
    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(4, 5);
    expect(result.current.itemSnapGuides).toEqual([]);
  });

  // "draws no snap guide toward a hidden station" was the same setup and the
  // same guide assertion as the test above, which also pins the position.
});
