import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useItemDrag, type ItemDragApi } from './useItemDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { clearHistory, historyDepth } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, snapPointToGrid, type SnapModes } from '../../geometry/snap';
import { makeGuide, makeLine, stationWithStop } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { StationId } from '../../model/types';

// The free transfer-anchor arm of useItemDrag. It shares the gesture machine
// with bullets and labels but has two rules of its own: a bare point snaps
// straight through the point snapper (no line to align along, no alignment box
// of corners), and it is the ONE draggable kind with a mode gate — an anchor is
// clickable while a transfer is being drawn, and a wobble there must stay a
// pick rather than becoming a drag.

type Result = { current: ItemDragApi };
const anchorDown = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onAnchorPointerDown(id, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

const anchorAt = () => useDoc.getState().transferAnchors['a1'];

function render() {
  const { ref } = fakeSvgRef();
  return renderHook(() => useItemDrag(ref, 1, false)).result;
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedAnchorIds: [],
    uiMode: { kind: 'idle' },
  });
  setModes({ line: false, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
  useDoc.setState({
    ...useDoc.getState(),
    transferAnchors: { a1: { id: 'a1', x: 50, y: 50 } },
  });
});

describe('useItemDrag — dragging a free transfer anchor', () => {
  it('moves the anchor by the world delta and commits ONE history entry', () => {
    const r = render();
    const before = historyDepth();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(r, pointerEvent({ clientX: 30, clientY: -12 }));
    move(r, pointerEvent({ clientX: 37, clientY: -20 }));
    up(r, pointerEvent({ clientX: 37, clientY: -20 }));
    expect(anchorAt()).toMatchObject({ x: 87, y: 30 });
    // Many moveTransferAnchor writes, one undo step.
    expect(historyDepth() - before).toBe(1);
  });

  it('grid-snaps the anchor point itself — it has no box to snap by', () => {
    setModes({ grid: 'both' });
    const expected = snapPointToGrid(50 + 37, 50 + 23, 'both');
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(r, pointerEvent({ clientX: 37, clientY: 23 }));
    expect(anchorAt().x).toBeCloseTo(expected.x, 5);
    expect(anchorAt().y).toBeCloseTo(expected.y, 5);
  });

  it("'Snap to all' aligns it to a station stop with a labeled guide, Shift bypasses", () => {
    setModes({ all: 'all' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
    });
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    // Proposed (103, 200): 3 world units off the stop's vertical axis x = 100,
    // and far enough down its diagonals that only the vertical is in reach.
    move(r, pointerEvent({ clientX: 53, clientY: 150 }));
    expect(anchorAt().x).toBeCloseTo(100, 5);
    expect(anchorAt().y).toBeCloseTo(200, 5);
    expect(r.current.itemSnapGuides.length).toBeGreaterThan(0);

    move(r, pointerEvent({ clientX: 53, clientY: 150, shiftKey: true }));
    expect(anchorAt().x).toBeCloseTo(103, 5);
    expect(r.current.itemSnapGuides).toEqual([]);
  });

  it('snaps onto an alignment guide, and drops the guides on pointerup', () => {
    useDoc.setState({
      ...useDoc.getState(),
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 200 }) },
    });
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    // Proposed (50, 197) — within tolerance of the guide at y = 200. Guides
    // snap with every snap MODE off: they are placed ink, not an inferred
    // alignment.
    move(r, pointerEvent({ clientX: 0, clientY: 147 }));
    expect(anchorAt().y).toBeCloseTo(200, 5);
    expect(r.current.itemSnapGuides.length).toBeGreaterThan(0);
    up(r, pointerEvent({ clientX: 0, clientY: 147 }));
    expect(r.current.itemSnapGuides).toEqual([]);
  });

  it('a pointercancel rolls the anchor back to where the drag began', () => {
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(r, pointerEvent({ clientX: 37, clientY: 23 }));
    expect(anchorAt().x).toBe(87);
    act(() => r.current.onPointerCancel());
    expect(anchorAt()).toMatchObject({ x: 50, y: 50 });
  });
});

describe('useItemDrag — the anchor mode gate', () => {
  // The gate exists because an anchor is CLICKABLE in creating-transfer mode
  // (picking it as a transfer end is the whole reason anchors exist). Without
  // it, a few px of wobble while picking would start a drag, set
  // suppressClick, and silently eat the pick.
  it('refuses to start while a transfer is being drawn — the click still lands', () => {
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'creating-transfer', firstEnd: null },
    });
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(r, pointerEvent({ clientX: 37, clientY: 23 }));
    up(r, pointerEvent({ clientX: 37, clientY: 23 }));
    expect(anchorAt()).toMatchObject({ x: 50, y: 50 });
    expect(dragState.suppressClick).toBe(false);
  });

  it('refuses in placing-anchor mode too — every non-idle mode is gated', () => {
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'placing-anchor' } });
    const r = render();
    anchorDown(r, 'a1', pointerEvent({ clientX: 0, clientY: 0 }));
    move(r, pointerEvent({ clientX: 37, clientY: 23 }));
    expect(anchorAt()).toMatchObject({ x: 50, y: 50 });
  });

  it('a bullet drag is NOT gated by the mode — the gate is the anchors alone', () => {
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'placing-anchor' } });
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        b1: { id: 'b1', x: 50, y: 50, rotation: 0, lineId: null, shape: 'circle', size: 8 },
      },
    });
    const r = render();
    act(() => r.current.onBulletPointerDown('b1', pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 37, clientY: 23 }));
    expect(useDoc.getState().routeBullets['b1']).toMatchObject({ x: 87, y: 73 });
  });
});
