import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStationLayoutDrag, type StationLayoutDragApi } from './useStationLayoutDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { Station } from '../../model/types';
import type { LayoutDragSource } from './useStationLayoutDrag';

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
      L1: {
        id: 'L1',
        service: '1',
        name: '1 line',
        color: '#111111',
        stations: Object.keys(stations),
      },
      L2: {
        id: 'L2',
        service: '2',
        name: '2 line',
        color: '#222222',
        stations: Object.keys(stations),
      },
    },
    lineOrder: ['L1', 'L2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    uiMode: { kind: 'editing-station-layout', stationId: 'a' },
    selectedStopLineId: null,
    labelSelected: false,
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
