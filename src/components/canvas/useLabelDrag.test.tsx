import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLabelDrag, type LabelDragApi } from './useLabelDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { Station } from '../../model/types';

type Result = { current: LabelDragApi };
const down = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onStartLabelDrag(id, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

// Identity projection: screen (x, y) = world (x, y).
const identity = (x: number, y: number) => ({ x, y });

// Station at world (100, 100), rotation 0: stops L1 at cell (0,0) and L2 at
// (0,1), label at (0,-1) — one world cell = STOP_SIZE = 14. The label's
// world position is (100 - 14, 100) = (86, 100).
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

describe('useLabelDrag — coarse ghost placement', () => {
  it('dropping on a ghost slot moves the label cell in ONE history entry', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    // Grab the label at its world position (86, 100), drag to world
    // (100, 86) = station-local cell (-1, 0) — a ghost of anchor L1.
    down(result, 'a', pointerEvent({ clientX: 86, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const st = useDoc.getState().stations.a;
    expect(st.label.row).toBeCloseTo(-1, 3);
    expect(st.label.col).toBeCloseTo(0, 3);
    // The station itself did not move, offsets untouched.
    expect(st.x).toBe(100);
    expect(st.label.offset).toBe(0);
    expect(historyDepth()).toBe(1);
    // A completed drag arms the label sub-selection so arrow-key nudging
    // continues from where the drop landed.
    expect(useSelection.getState().labelSelected).toBe(true);
  });

  it('publishes the ghost overlay while dragging and clears it on release', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    down(result, 'a', pointerEvent({ clientX: 86, clientY: 100 }));
    expect(result.current.overlay).toBeNull(); // below the move threshold
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    const ov = result.current.overlay;
    expect(ov?.stationId).toBe('a');
    expect(ov?.mode).toBe('ghost');
    expect(ov && ov.ghosts.length).toBeGreaterThan(0);
    expect(ov?.over).toMatchObject({ row: -1, col: 0 });
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));
    expect(result.current.overlay).toBeNull();
  });

  it('a drop far from every ghost is a no-op (no history entry)', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    down(result, 'a', pointerEvent({ clientX: 86, clientY: 100 }));
    move(result, pointerEvent({ clientX: 500, clientY: 500 }));
    up(result, pointerEvent({ clientX: 500, clientY: 500 }));

    const st = useDoc.getState().stations.a;
    expect(st.label.row).toBe(0);
    expect(st.label.col).toBe(-1);
    expect(historyDepth()).toBe(0);
  });
});

describe('useLabelDrag — Alt fine offsets', () => {
  it('Alt drag live-writes offsets, then commits ONE entry rounded to integers', () => {
    seed({ a: hubStation() });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    down(result, 'a', pointerEvent({ clientX: 86, clientY: 100 }));
    move(result, pointerEvent({ clientX: 91, clientY: 100, altKey: true }));
    // Live: the painted label follows the cursor (offset = +5 along reading E).
    expect(useDoc.getState().stations.a.label.offset).toBeCloseTo(5, 6);
    expect(result.current.overlay?.mode).toBe('fine');

    move(result, pointerEvent({ clientX: 89.4, clientY: 103.6, altKey: true }));
    up(result, pointerEvent({ clientX: 89.4, clientY: 103.6, altKey: true }));

    const st = useDoc.getState().stations.a;
    expect(st.label.offset).toBe(3); // 3.4 rounded
    expect(st.label.offsetPerp ?? 0).toBe(4); // 3.6 rounded
    expect(st.label.row).toBe(0); // cell untouched
    expect(st.label.col).toBe(-1);
    expect(historyDepth()).toBe(1);
  });

  it('releasing Alt mid-gesture restores the start offsets before ghost placement', () => {
    seed({
      a: hubStation({
        label: { row: 0, col: -1, rotation: 0, offset: 2, align: 'auto', valign: 'middle' },
      }),
    });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    down(result, 'a', pointerEvent({ clientX: 84, clientY: 100 }));
    move(result, pointerEvent({ clientX: 91, clientY: 100, altKey: true }));
    expect(useDoc.getState().stations.a.label.offset).toBeCloseTo(9, 6); // 2 + 7
    // Alt released: offsets restore, the ghost lattice takes over.
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    expect(useDoc.getState().stations.a.label.offset).toBe(2);
    expect(result.current.overlay?.mode).toBe('ghost');
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const st = useDoc.getState().stations.a;
    expect(st.label.row).toBeCloseTo(-1, 3);
    expect(st.label.col).toBeCloseTo(0, 3);
    expect(st.label.offset).toBe(2);
    expect(historyDepth()).toBe(1);
  });
});

describe('useLabelDrag — mirror matching', () => {
  it('a ghost drop broadcasts to matching stations in the same single entry', () => {
    seed({ a: hubStation(), b: hubStation({ id: 'b', x: 400 }) }, { mirrorMatching: true });
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useLabelDrag(ref, identity));

    down(result, 'a', pointerEvent({ clientX: 86, clientY: 100 }));
    move(result, pointerEvent({ clientX: 100, clientY: 86 }));
    up(result, pointerEvent({ clientX: 100, clientY: 86 }));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.row).toBeCloseTo(-1, 3);
    expect(doc.stations.b.label.row).toBeCloseTo(-1, 3);
    expect(doc.stations.b.label.col).toBeCloseTo(0, 3);
    expect(historyDepth()).toBe(1);
  });
});
