import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStopMetrics } from './useStopMetrics';
import { useDoc } from '../state/store';
import { makeDoc, makeLine, makeStation, makeStop, makeTransfer } from '../test/fixtures';
import type { Line } from '../model/types';

/**
 * `useStopMetrics` is called once per STATION component (the label, the hit
 * area and its drag proxy, the silhouette), so a map's worth of them share one
 * doc state. `stopMetricsOf` indexes every transfer eagerly when it is built,
 * making a per-instance build O(stations x transfers) on any station write —
 * paid every pointermove of a label fine-drag, which the memo contract
 * (ARCHITECTURE: "Memo contract") exists to keep cheap. So the build is shared
 * across instances, and identity is the observable: one reference means one
 * build.
 */

// s1 — s2 as a real edge, with horizontal stops: that is what makes the
// terminus-aware `continues` bits responsive to a move at all, and so what
// lets the tests below tell "a move that changes nothing" apart from "a move
// that changes the answer".
const lines: Record<string, Line> = { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) };

beforeEach(() => {
  useDoc.setState(
    makeDoc({
      lines: [lines.L1],
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1', { orientation: 'auto-horizontal' })] }),
        makeStation({
          id: 's2',
          x: 100,
          stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
        }),
      ],
      transfers: [
        makeTransfer({
          id: 't1',
          a: { stationId: 's1', lineId: 'L1' },
          b: { stationId: 's2', lineId: 'L1' },
        }),
      ],
    }),
  );
});

describe('useStopMetrics', () => {
  it('hands every component the same build for one doc state', () => {
    const a = renderHook(() => useStopMetrics(lines));
    const b = renderHook(() => useStopMetrics(lines));
    expect(a.result.current).toBe(b.result.current);
  });

  it('a station MOVE that changes nothing it answers keeps the same build', () => {
    // The reason the hook exists in this shape. s2 slides further along the
    // same side of s1, so no stop cell moves and no `continues` bit flips —
    // the lookup's answer is identical for every station on the map, and a
    // fresh function here would re-render all of them (this hook is called
    // inside StationView, past its memo).
    const { result, rerender } = renderHook(() => useStopMetrics(lines));
    const before = result.current;
    useDoc.getState().moveStation('s2', 140, 0);
    rerender();
    expect(result.current).toBe(before);
  });

  it('…but a move that DOES change the answer rebuilds', () => {
    const { result, rerender } = renderHook(() => useStopMetrics(lines));
    const st = useDoc.getState().stations.s1;
    expect(result.current(st, st.stops[0]).continues).toEqual({ plus: true, minus: false });
    const before = result.current;
    // Drag s2 across to s1's other side: s1's continuation flips sides.
    useDoc.getState().moveStation('s2', -100, 0);
    rerender();
    expect(result.current).not.toBe(before);
    const after = useDoc.getState().stations.s1;
    expect(result.current(after, after.stops[0]).continues).toEqual({ plus: false, minus: true });
  });

  it('reports the live transfer cap after a transfer is added', () => {
    const { result, rerender } = renderHook(() => useStopMetrics(lines));
    const st = useDoc.getState().stations.s1;
    const before = result.current(st, st.stops[0]).transfers;
    expect(before.length).toBeGreaterThan(0);

    useDoc.setState({ transfers: {} });
    rerender();
    expect(result.current(st, st.stops[0]).transfers).toEqual([]);
  });
});
