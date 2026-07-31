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

const lines: Record<string, Line> = { L1: makeLine({ id: 'L1' }) };

beforeEach(() => {
  useDoc.setState(
    makeDoc({
      lines: [lines.L1],
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', x: 100, stops: [makeStop('L1')] }),
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

  it('rebuilds when a station moves, so the answer never goes stale', () => {
    const { result, rerender } = renderHook(() => useStopMetrics(lines));
    const before = result.current;
    useDoc.getState().moveStation('s2', 140, 0);
    rerender();
    expect(result.current).not.toBe(before);
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
