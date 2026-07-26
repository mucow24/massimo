import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStationLayoutDrag, type StationLayoutDragApi } from './useStationLayoutDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC, rotateStationLayoutBy90 } from '../../model/transforms';
import { findMatchingStations } from '../../model/matching';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { Station } from '../../model/types';
import type { LayoutDragSource } from './useStationLayoutDrag';
import { makeLine } from '../../test/fixtures';

type Result = { current: StationLayoutDragApi };
const down = (r: Result, id: string, source: LayoutDragSource, e: React.PointerEvent) =>
  act(() => r.current.onStartNodeDrag(id, source, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

const identity = (x: number, y: number) => ({ x, y });

// Station at world (100, 100), rotation 0: stops L1 (0,0) + L2 (0,1),
// label at (0,-1). One cell = 14 world units.
const hubStation = (over: Partial<Station> = {}): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 100,
  rotation: 0,
  stops: [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
  ],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  ...over,
});

const seed = (stations: Record<string, Station>, over: Record<string, unknown> = {}) => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations,
    lines: {
      L1: makeLine({
        id: 'L1',
        service: '1',
        name: '1 line',
        color: '#111111',
        stations: Object.keys(stations),
      }),
      L2: makeLine({
        id: 'L2',
        service: '2',
        name: '2 line',
        color: '#222222',
        stations: Object.keys(stations),
      }),
    },
    lineOrder: ['L1', 'L2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    uiMode: { kind: 'editing-station-layout', stationId: 'a' },
    selectedStopLineId: null,
    labelSelected: false,
    selectedAnchorCellId: null,
    mirrorMatching: false,
    ...over,
  });
  useDoc.temporal.getState().clear();
};

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
});

describe('useStationLayoutDrag — stop drag', () => {
  it('dropping a stop on a ghost slot commits moveStop in ONE history entry', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    // Grab L1 at its world position (100, 100); drag up one slot to
    // world (100, 86) = local cell (-1, 0).
    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const st = useDoc.getState().stations.a;
    const stop = st.stops.find((s) => s.lineId === 'L1')!;
    expect(stop.row).toBeCloseTo(-1, 3);
    expect(stop.col).toBeCloseTo(0, 3);
    expect(st.x).toBe(100); // station itself put
    expect(historyDepth()).toBe(1);
  });

  it('dropping a stop ON another stop swaps their cells', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    // Grab L1 at (100,100), drop dead-center on L2 at (114, 100).
    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 114, clientY: 100 }));
    up(result, pointerEvent({ clientX: 114, clientY: 100 }));

    const st = useDoc.getState().stations.a;
    expect(st.stops.find((s) => s.lineId === 'L1')!.col).toBeCloseTo(1, 3);
    expect(st.stops.find((s) => s.lineId === 'L2')!.col).toBeCloseTo(0, 3);
    expect(historyDepth()).toBe(1);
  });

  it('a no-move click on a stop selects it (arming pickers + keyboard nudge)', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'stop', lineId: 'L2' }, pointerEvent({ clientX: 114, clientY: 100 }));
    up(result, pointerEvent({ clientX: 114, clientY: 100 }));

    expect(useSelection.getState().selectedStopLineId).toBe('L2');
    expect(historyDepth()).toBe(0);
  });

  it('publishes ghosts + the resolved drop target while dragging', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    const ov = result.current.overlay;
    expect(ov?.stationId).toBe('a');
    expect(ov?.source).toEqual({ kind: 'stop', lineId: 'L1' });
    expect(ov && ov.ghosts.length).toBeGreaterThan(0);
    expect(ov?.over).toMatchObject({ kind: 'ghost', row: -1, col: 0 });
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));
    expect(result.current.overlay).toBeNull();
  });
});

describe('useStationLayoutDrag — label drag', () => {
  it('moves the label cell via the ghost lattice (no swap onto stops)', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    // Label at world (86, 100); drop at world (100, 114) = cell (1, 0).
    down(result, 'a', { kind: 'label' }, pointerEvent({ clientX: 86, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 114 }));
    up(result, pointerEvent({ clientX: 100, clientY: 114 }));

    const st = useDoc.getState().stations.a;
    expect(st.label.row).toBeCloseTo(1, 3);
    expect(st.label.col).toBeCloseTo(0, 3);
    expect(historyDepth()).toBe(1);
  });

  it('a no-move click on the label ring selects the label', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'label' }, pointerEvent({ clientX: 86, clientY: 100 }));
    up(result, pointerEvent({ clientX: 86, clientY: 100 }));

    expect(useSelection.getState().labelSelected).toBe(true);
  });
});

describe('useStationLayoutDrag — mirror matching', () => {
  it('a stop drop broadcasts to matches captured at gesture start, one entry', () => {
    seed({ a: hubStation(), b: hubStation({ id: 'b', x: 400 }) }, { mirrorMatching: true });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const doc = useDoc.getState();
    expect(doc.stations.a.stops.find((s) => s.lineId === 'L1')!.row).toBeCloseTo(-1, 3);
    expect(doc.stations.b.stops.find((s) => s.lineId === 'L1')!.row).toBeCloseTo(-1, 3);
    expect(historyDepth()).toBe(1);
  });

  it("rotates the drag delta into a 180°-offset match's grid frame", () => {
    // b renders identically to a but stores its layout rotated two 90°-steps
    // (with the station rotation compensating), so the match carries
    // layoutOffset 2 and a broadcast delta must be rotated — copying
    // (dRow, dCol) verbatim would move b's stop the wrong way in the world.
    const b = rotateStationLayoutBy90(
      rotateStationLayoutBy90(hubStation({ id: 'b', x: 400 }), 1),
      1,
    );
    seed({ a: hubStation(), b }, { mirrorMatching: true });
    expect(findMatchingStations(useDoc.getState(), 'a')).toEqual([{ id: 'b', layoutOffset: 2 }]);

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    // Drag a's L1 stop up one cell: (dRow, dCol) = (-1, 0) in a's frame.
    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const doc = useDoc.getState();
    const bStop = doc.stations.b.stops.find((s) => s.lineId === 'L1')!;
    // In b's 180°-rotated grid the same world-up move is (dRow, dCol) = (1, 0).
    expect(bStop.row).toBeCloseTo(1, 3);
    expect(bStop.col).toBeCloseTo(0, 3);
    expect(historyDepth()).toBe(1);
  });
});

describe('useStationLayoutDrag — rotated station', () => {
  it("projects the cursor through the station's rotation into the local grid", () => {
    // rotation 2 = 90° cw: local +col points world-DOWN, so a world-LEFT
    // drag must land in local cell (row +1, col 0). An unrotated projection
    // would put it at (0, -1) — wrong cell, and visibly wrong on screen.
    seed({ a: hubStation({ rotation: 2 }) });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 86, clientY: 100 }));
    up(result, pointerEvent({ clientX: 86, clientY: 100 }));

    const stop = useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!;
    expect(stop.row).toBeCloseTo(1, 3);
    expect(stop.col).toBeCloseTo(0, 3);
  });
});

describe('useStationLayoutDrag — whiffed drop', () => {
  it('a moved drag released away from any slot changes nothing and records no history', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    // Drag L1 far outside the ghost lattice's reach and release.
    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 400, clientY: 400 }));
    up(result, pointerEvent({ clientX: 400, clientY: 400 }));

    const stop = useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!;
    expect(stop.row).toBeCloseTo(0, 3);
    expect(stop.col).toBeCloseTo(0, 3);
    // The gesture's history group must commit as a no-op, not litter undo.
    expect(historyDepth()).toBe(0);
  });
});

describe('useStationLayoutDrag — stationary Shift flips the lattice basis', () => {
  it('window Shift keydown mid-drag recomputes ghosts without a pointermove', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));

    down(result, 'a', { kind: 'stop', lineId: 'L1' }, pointerEvent({ clientX: 100, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    // Orthogonal basis: the straight-up slot (-1, 0) is a ghost.
    const hasCell = (row: number, col: number) =>
      !!result.current.overlay?.ghosts.some(
        (g) => Math.abs(g.row - row) < 1e-3 && Math.abs(g.col - col) < 1e-3,
      );
    expect(hasCell(-1, 0)).toBe(true);

    // Press Shift with the cursor STATIONARY: the diagonal basis replaces the
    // cardinals (tangent diagonals at ±√2/2).
    act(() => {
      window.dispatchEvent(
        Object.assign(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }), {}),
      );
    });
    expect(hasCell(-1, 0)).toBe(false);
    expect(hasCell(-Math.SQRT1_2, 1 - Math.SQRT1_2)).toBe(true);
    up(result, pointerEvent({ clientX: 100, clientY: 86, shiftKey: true }));
  });
});

describe('useStationLayoutDrag — hosted transfer anchor', () => {
  const withAnchor = () => hubStation({ transferAnchors: [{ id: 'k1', row: 1, col: 0 }] });

  it('drags onto a ghost slot and arms itself as the sub-selection', () => {
    seed({ a: withAnchor() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));
    const src: LayoutDragSource = { kind: 'anchor', anchorId: 'k1' };
    down(result, 'a', src, pointerEvent({ clientX: 100, clientY: 114 }));
    // Drag up toward the row above the stop row.
    move(result, pointerEvent({ clientX: 100, clientY: 72 }));
    up(result, pointerEvent({ clientX: 100, clientY: 72 }));

    const cell = useDoc.getState().stations.a.transferAnchors![0];
    expect(cell.id).toBe('k1');
    expect({ row: cell.row, col: cell.col }).not.toEqual({ row: 1, col: 0 });
    expect(useSelection.getState().selectedAnchorCellId).toBe('k1');
  });

  it('a no-move click just arms it, clearing the stop/label arms', () => {
    seed({ a: withAnchor() }, { selectedStopLineId: 'L1' });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));
    const e = pointerEvent({ clientX: 100, clientY: 114 });
    down(result, 'a', { kind: 'anchor', anchorId: 'k1' }, e);
    up(result, e);
    const sel = useSelection.getState();
    expect(sel.selectedAnchorCellId).toBe('k1');
    // The three sub-selection arms are mutually exclusive.
    expect(sel.selectedStopLineId).toBeNull();
    expect(sel.labelSelected).toBe(false);
    expect(historyDepth()).toBe(0); // a pure click burns no undo entry
  });

  it('does NOT fan out to mirror matches', () => {
    // The blocking reason: mirror targets are keyed by (stationId, lineId) and
    // matched by stopsKey, which deliberately ignores anchors — so two stations
    // with DIFFERENT anchor sets still MATCH. Every target would then apply its
    // own rotated delta to the SAME global anchorId, and an offset-0/offset-2
    // pair (180° apart) cancels outright: the anchor would not move at all.
    const mirrored = rotateStationLayoutBy90(rotateStationLayoutBy90(hubStation(), 1), 1);
    seed(
      { a: withAnchor(), b: { ...mirrored, id: 'b', name: 'B', x: 400, y: 400 } },
      { mirrorMatching: true },
    );
    // Precondition: the two stations really do match, so the fan-out is live.
    expect(findMatchingStations(useDoc.getState(), 'a').length).toBeGreaterThan(0);

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useStationLayoutDrag(ref, identity));
    down(
      result,
      'a',
      { kind: 'anchor', anchorId: 'k1' },
      pointerEvent({ clientX: 100, clientY: 114 }),
    );
    move(result, pointerEvent({ clientX: 100, clientY: 72 }));
    up(result, pointerEvent({ clientX: 100, clientY: 72 }));

    const doc = useDoc.getState();
    // The source moved...
    expect(doc.stations.a.transferAnchors![0]).not.toEqual({ id: 'k1', row: 1, col: 0 });
    // ...and the match grew no anchor of its own.
    expect(doc.stations.b.transferAnchors).toBeUndefined();
  });
});
