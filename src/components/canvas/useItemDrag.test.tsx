import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useItemDrag, type ItemDragApi } from './useItemDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { clearHistory, historyDepth } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, snapPointToGrid, type SnapModes } from '../../geometry/snap';
import { measureTextLabel } from '../../geometry/textMeasure';
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
  // The named reset, not raw temporal.clear(): several tests here end
  // mid-gesture on purpose (no pointerup), and clearHistory also cancels that
  // still-open group so its stale snapshot can't leak into the next test.
  clearHistory();
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

  it('snaps a bullet INSIDE the radius onto the axis (positive companion)', () => {
    // Companion to the negative case at the same zoom. The negative-only test
    // still passes if snapping is disabled / the radius collapses to 0; this
    // one fails in that case.
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

    // Drag b1 to world (4, 50): screen Δ = (-92, 0) at zoom 2. perp dist to axis
    // x=0 is 4 < 5 → snaps to x=0.
    bulletDown(result, 'b1', pointerEvent({ clientX: 200, clientY: 200 }));
    move(result, pointerEvent({ clientX: 108, clientY: 200 }));
    up(result, pointerEvent({ clientX: 108, clientY: 200 }));

    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(0, 5);
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

describe('useItemDrag — unbound bullet alignment via the point snapper', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
      routeBullets: {
        b1: { id: 'b1', x: 0, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
  });

  it("'Snap to all' aligns an unbound bullet's center to a station stop, with a guide", () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    // Propose (103, 50): 3 from the stop's vertical axis x=100 → snaps.
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 103, clientY: 50 }));

    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(100, 5);
    expect(useDoc.getState().routeBullets['b1'].y).toBeCloseTo(50, 5);
    expect(result.current.itemSnapGuides).toHaveLength(1);
    expect(result.current.itemSnapGuides[0].label).toBe('50');
  });

  it('an unbound bullet master never aligns to a CO-SELECTED station', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    resetSelection({ selectedRouteBulletIds: ['b1'], selectedStationIds: ['S'] });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 103, clientY: 50 }));

    // S moves with the group → excluded → the bullet stays at the raw 103.
    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(103, 5);
    expect(result.current.itemSnapGuides).toHaveLength(0);
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

  it('grid-snaps the dragged label by its VISIBLE upper-left corner (no hit pad)', () => {
    setModes({ line: false, all: 'off', grid: 'both' });
    const label = useDoc.getState().textLabels['g1'];
    const m = measureTextLabel(label);
    // The text bbox's own corner lands on the grid — not the padded hit rect.
    const ul = snapPointToGrid(37 - m.width / 2, 23 - m.height / 2, 'both');
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 37, clientY: 23 }));
    const g = useDoc.getState().textLabels['g1'];
    expect(g.x).toBeCloseTo(ul.x + m.width / 2, 5);
    expect(g.y).toBeCloseTo(ul.y + m.height / 2, 5);
  });

  it('a ROTATED label grid-snaps by its topmost-then-leftmost rotated corner', () => {
    setModes({ line: false, all: 'off', grid: 'both' });
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 0, y: 0, rotation: 2 }) },
    });
    const m = measureTextLabel(useDoc.getState().textLabels['g1']);
    const hw = m.width / 2;
    const hh = m.height / 2;
    // At 90° CW the topmost-then-leftmost visible corner sits at
    // center + (-hh, -hw) (the rotated bottom-left of the unrotated bbox).
    const anchor = snapPointToGrid(37 - hh, 23 - hw, 'both');
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 37, clientY: 23 }));
    const g = useDoc.getState().textLabels['g1'];
    expect(g.x).toBeCloseTo(anchor.x + hh, 5);
    expect(g.y).toBeCloseTo(anchor.y + hw, 5);
  });

  it("'Snap to all' aligns a label's corner to a station stop, with a labeled guide", () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
    });
    const m = measureTextLabel(useDoc.getState().textLabels['g1']);
    const hw = m.width / 2;
    const hh = m.height / 2;
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    // Propose the label's UL corner at (103, 50): 3 from the stop's vertical
    // axis x=100 → the corner snaps onto it, y stays free.
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: 103 + hw, clientY: 50 + hh }));

    const g = useDoc.getState().textLabels['g1'];
    expect(g.x).toBeCloseTo(100 + hw, 5);
    expect(g.y).toBeCloseTo(50 + hh, 5);
    expect(result.current.itemSnapGuides).toHaveLength(1);
    expect(result.current.itemSnapGuides[0].label).toBe('50');
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
      backgroundOrder: ['p1'],
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

  it('grabbing a selected bullet carries the group (unbound bullet: no snap engages)', () => {
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

  it('a bound bullet master keeps line snap against stationary stations, towing by the snapped delta', () => {
    // Bind b1 to L1 and select only the bullet + one label — station S stays
    // unselected, so it is a stable target the group-dragged bullet may snap to.
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { ...useDoc.getState().routeBullets['b1'], x: 200, y: 50, lineId: 'L1' },
      },
    });
    setModes({ line: true, all: 'off', grid: 'off' });
    resetSelection({ selectedRouteBulletIds: ['b1'], selectedLabelIds: ['g1'] });

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    // S's auto-vertical stop sits at (100, 0) → vertical axis x=100. Δ(−96,0)
    // proposes b1 at (104, 50): 4 inside the radius → snaps to x=100.
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: -96, clientY: 0 }));

    const doc = useDoc.getState();
    expect(doc.routeBullets['b1'].x).toBeCloseTo(100, 5);
    expect(doc.routeBullets['b1'].y).toBeCloseTo(50, 5);
    // The towed label moves by the POST-SNAP delta (−100, 0), not the raw −96.
    expect(doc.textLabels['g1'].x).toBeCloseTo(-100, 5);
  });

  it('a bound bullet master never snaps to a CO-SELECTED station (unstable target)', () => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { ...useDoc.getState().routeBullets['b1'], x: 200, y: 50, lineId: 'L1' },
      },
    });
    setModes({ line: true, all: 'off', grid: 'off' });
    resetSelection({ selectedRouteBulletIds: ['b1'], selectedStationIds: ['S'] });

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    bulletDown(result, 'b1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(result, pointerEvent({ clientX: -96, clientY: 0 }));

    const doc = useDoc.getState();
    // S moves with the group, so its axis must not capture the drag: raw 104.
    expect(doc.routeBullets['b1'].x).toBeCloseTo(104, 5);
    expect(doc.stations['S' as StationId].x).toBeCloseTo(100 - 96, 5);
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

describe('useItemDrag — a locked item lets the pointerdown bubble (marquee can begin over it)', () => {
  // A locked item can't be dragged, so a drag starting on it should rubber-band
  // rather than do nothing. That requires the pointerdown to bubble to the
  // canvas — i.e. NOT be swallowed by stopPropagation. An unlocked item still
  // swallows it so dragging the item doesn't also start a marquee.
  function spyEvent(): { e: React.PointerEvent; stopped: () => boolean } {
    let stopped = false;
    const e = {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      button: 0,
      shiftKey: false,
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as React.PointerEvent;
    return { e, stopped: () => stopped };
  }

  it('a locked bullet does not stop propagation', () => {
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
    });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    const { e, stopped } = spyEvent();
    bulletDown(result, 'b1', e);
    expect(stopped()).toBe(false);
  });

  it('a locked label does not stop propagation', () => {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 0, y: 0, locked: true }) },
    });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    const { e, stopped } = spyEvent();
    labelDown(result, 'g1', e);
    expect(stopped()).toBe(false);
  });

  it('an unlocked bullet stops propagation so dragging it does not also rubber-band', () => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { id: 'b1', x: 5, y: 5, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    const { e, stopped } = spyEvent();
    bulletDown(result, 'b1', e);
    expect(stopped()).toBe(true);
  });
});
