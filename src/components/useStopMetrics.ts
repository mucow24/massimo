import { useMemo } from 'react';
import type { Line } from '../model/types';
import { stopMetricsOf } from '../model/stopMetrics';
import { useDoc } from '../state/store';
import type { StopMetricsFn } from '../geometry/labelLayout';

/**
 * The per-stop metrics every station-geometry consumer on the canvas must share
 * — the painted label, its hit rect, and its selection silhouette all derive
 * from the same lookup or they drift apart (see `StopMetrics`).
 *
 * Takes `lines` rather than reading it, because the callers differ: some hold
 * it as a prop, `StationSilhouette` reads it from the store. Transfers and
 * stations are read here so no caller has to know they are part of the answer
 * (stations resolve `continues` — the terminus-aware beside-slant gate).
 *
 * The `useMemo` is only the per-component half. This hook runs once per STATION
 * component (label, hit rect, drag proxy, silhouette), so a per-instance memo
 * still rebuilds a map's worth of them on every station write — and
 * `stopMetricsOf` indexes every transfer eagerly as it is built, making that
 * O(stations × transfers) on each frame of a label fine-drag, which the memo
 * contract (ARCHITECTURE: "Memo contract") exists to keep cheap. The build is
 * shared across instances by `stopMetricsOf`'s own last-result cache; the
 * `useMemo` stays as the local fast path, so a re-render for any other reason
 * doesn't even reach that comparison.
 */
export function useStopMetrics(lines: Record<string, Line>): StopMetricsFn {
  const transfers = useDoc((s) => s.transfers);
  const stations = useDoc((s) => s.stations);
  return useMemo(() => stopMetricsOf({ lines, transfers, stations }), [lines, transfers, stations]);
}
