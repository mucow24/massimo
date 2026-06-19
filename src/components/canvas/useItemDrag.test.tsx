import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useItemDrag, type ItemDragApi } from './useItemDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, snapLabelToGrid, type SnapModes } from '../../geometry/snap';
import { measureTextLabel } from '../../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../../geometry/stationBoundary';
import { stationWithStop, makeLine, makeTextLabel, makePolygon } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { StationId } from '../../model/types';

type Result = { current: ItemDragApi };
const bulletDown = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onBulletPointerDown(id, e));
const labelDown = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onLabelPointerDown(id, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

function resetSelection(over: Record<string, unknown> = {}) {
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    ...over,
  });
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  resetSelection();
  setModes({ line: true, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
});

describe('useItemDrag — bullet snap engages within a constant screen distance', () => {
  it('zooming in shrinks the world-space bullet snap radius (10px / zoom)', () => {
    // Station A has an auto-vertical stop on L1 at (0,0) → a vertical snap axis
    // at x=0. The bullet b1 is bound to L1, so it snaps onto that axis.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
      routeBullets: {
        b1: { id: 'b1', x: 50, y: 50, rotation: 0, lineId: 'L1', shape: 'circle', size: 8 },
      },
    });

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 2, false));

    // Drag b1 (unselected → not a group drag; no shift) to world (7, 50): screen
    // Δ = (-86, 0) at zoom 2. perp dist to axis x=0 is 7.
    bulletDown(result, 'b1', pointerEvent({ clientX: 200, clientY: 200 }));
    move(result, pointerEvent({ clientX: 114, clientY: 200 }));
    up(result, pointerEvent({ clientX: 114, clientY: 200 }));

    // Screen radius is 10px / 2 = 5 world units; 7 > 5 → no snap, X stays 7.
    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(7, 5);
    expect(useDoc.getState().routeBullets['b1'].y).toBeCloseTo(50, 5);
  });
});

describe('useItemDrag — unbound bullet grid-snap fallback', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        // lineId null → snap engine is skipped, grid fallback applies.
        b1: { id: 'b1', x: 0, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
    setModes({ line: false, all: 'off', grid: 'both' });
  });

  it('snaps a free bullet to the nearest grid intersection', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 23, clientY: 4 })); // world (23,4) → grid (20,0)
    expect(useDoc.getState().routeBullets['b1'].x).toBe(20);
    expect(useDoc.getState().routeBullets['b1'].y).toBe(0);
  });

  it('shift bypasses grid snap', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 23, clientY: 4, shiftKey: true }));
    expect(useDoc.getState().routeBullets['b1'].x).toBe(23);
    expect(useDoc.getState().routeBullets['b1'].y).toBe(4);
  });
});

describe('useItemDrag — early exits', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { id: 'b1', x: 5, y: 5, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
  });

  it('does nothing in hand mode', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, true)); // inHandMode
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 80, clientY: 0 }));
    expect(useDoc.getState().routeBullets['b1'].x).toBe(5);
  });

  it('ignores a non-left button', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0, button: 2 }));
    move(result, pointerEvent({ clientX: 80, clientY: 0 }));
    expect(useDoc.getState().routeBullets['b1'].x).toBe(5);
  });
});

describe('useItemDrag — history grouping', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { id: 'b1', x: 0, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
    setModes({ line: false, all: 'off', grid: 'off' });
  });

  it('commits exactly one history entry for a real drag', () => {
    const before = historyDepth();
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 }));
    up(result, pointerEvent({ clientX: 40, clientY: 0 }));
    expect(historyDepth()).toBe(before + 1);
    expect(dragState.suppressClick).toBe(true);
  });

  it('cancels history for a click with no movement', () => {
    const before = historyDepth();
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    up(result, pointerEvent({ clientX: 1, clientY: 0 }));
    expect(historyDepth()).toBe(before);
  });
});

describe('useItemDrag — label drag', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 0, y: 0 }) },
    });
    setModes({ line: false, all: 'off', grid: 'off' });
  });

  it('moves a label by the world-space delta (zoom-scaled)', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 2, false)); // zoom 2
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 })); // screen 40 / zoom 2 = 20
    expect(useDoc.getState().textLabels['g1'].x).toBe(20);
    expect(useDoc.getState().textLabels['g1'].y).toBe(0);
  });

  it('grid-snaps the dragged label by its visible upper-left', () => {
    setModes({ line: false, all: 'off', grid: 'both' });
    const label = useDoc.getState().textLabels['g1'];
    const m = measureTextLabel(label);
    const expected = snapLabelToGrid(
      { x: 37, y: 23 },
      m.width + 2 * TEXT_LABEL_HIT_PAD,
      m.height + 2 * TEXT_LABEL_HIT_PAD,
      'both',
    );
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 37, clientY: 23 }));
    const g = useDoc.getState().textLabels['g1'];
    expect(g.x).toBeCloseTo(expected.x, 5);
    expect(g.y).toBeCloseTo(expected.y, 5);
  });

  it('commits one history entry for a real label drag', () => {
    const before = historyDepth();
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 }));
    up(result, pointerEvent({ clientX: 40, clientY: 0 }));
    expect(historyDepth()).toBe(before + 1);
    expect(dragState.suppressClick).toBe(true);
  });

  it('cancels history for a label click with no movement', () => {
    const before = historyDepth();
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    up(result, pointerEvent({ clientX: 1, clientY: 0 }));
    expect(historyDepth()).toBe(before);
  });
});

describe('useItemDrag — group drag tows every selected item type', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
      routeBullets: {
        b1: { id: 'b1', x: 200, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
      textLabels: {
        g1: makeTextLabel({ id: 'g1', x: 0, y: 0 }),
        g2: makeTextLabel({ id: 'g2', x: 300, y: 0 }),
      },
      polygons: {
        p1: makePolygon({
          id: 'p1',
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        }),
      },
      polygonOrder: ['p1'],
    });
    setModes({ line: false, all: 'off', grid: 'off' });
    resetSelection({
      selectedLabelIds: ['g1', 'g2'],
      selectedRouteBulletIds: ['b1'],
      selectedStationIds: ['S'],
      selectedPolygonIds: ['p1'],
    });
  });

  it('grabbing the selected label carries every other selected item by the same delta', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 })); // delta = (40, 0)

    const doc = useDoc.getState();
    expect(doc.textLabels['g1'].x).toBe(40);
    expect(doc.textLabels['g2'].x).toBe(340); // sibling label tows along
    expect(doc.routeBullets['b1'].x).toBe(240);
    expect(doc.stations['S' as StationId].x).toBe(140);
    expect(doc.polygons['p1'].vertices[0].x).toBe(40);
    expect(doc.polygons['p1'].vertices[1].x).toBe(50);
  });

  it('grabbing a selected bullet carries the group (and suppresses line snap)', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 })); // delta = (40, 0)

    const doc = useDoc.getState();
    expect(doc.routeBullets['b1'].x).toBe(240);
    expect(doc.stations['S' as StationId].x).toBe(140);
    expect(doc.textLabels['g1'].x).toBe(40);
    expect(doc.polygons['p1'].vertices[0].x).toBe(40);
  });

  it('a locked selected sibling stays put while the rest of the group tows', () => {
    // Lock the sibling label g2 and sibling bullet b1: they must not move when
    // the group is dragged by grabbing g1. Mirrors locked polygons never towing.
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { ...useDoc.getState().routeBullets['b1'], locked: true },
      },
      textLabels: {
        ...useDoc.getState().textLabels,
        g2: { ...useDoc.getState().textLabels['g2'], locked: true },
      },
    });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 40, clientY: 0 })); // delta = (40, 0)

    const doc = useDoc.getState();
    expect(doc.textLabels['g1'].x).toBe(40); // grabbed item moves
    expect(doc.stations['S' as StationId].x).toBe(140); // unlocked sibling tows
    expect(doc.textLabels['g2'].x).toBe(300); // locked sibling stays put
    expect(doc.routeBullets['b1'].x).toBe(200); // locked sibling stays put
  });
});

describe('useItemDrag — locked items are inert', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: {
          id: 'b1',
          x: 5,
          y: 5,
          rotation: 0,
          lineId: null,
          shape: 'circle',
          size: 8,
          locked: true,
        },
      },
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 0, y: 0, locked: true }) },
    });
    setModes({ line: false, all: 'off', grid: 'off' });
  });

  it('a drag does not move a locked bullet', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 60, clientY: 20 }));
    up(result, pointerEvent({ clientX: 60, clientY: 20 }));
    expect(useDoc.getState().routeBullets['b1'].x).toBe(5);
    expect(useDoc.getState().routeBullets['b1'].y).toBe(5);
  });

  it('a drag does not move a locked label', () => {
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 60, clientY: 20 }));
    up(result, pointerEvent({ clientX: 60, clientY: 20 }));
    expect(useDoc.getState().textLabels['g1'].x).toBe(0);
    expect(useDoc.getState().textLabels['g1'].y).toBe(0);
  });
});
