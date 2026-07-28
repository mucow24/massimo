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
 * it as a prop, `StationSilhouette` reads it from the store. Transfers are read
 * here so no caller has to know they are part of the answer.
 *
 * Memoized on the two store slices: `stopMetricsOf` indexes every transfer once
 * when it's built, and these components render per station.
 */
export function useStopMetrics(lines: Record<string, Line>): StopMetricsFn {
  const transfers = useDoc((s) => s.transfers);
  return useMemo(() => stopMetricsOf({ lines, transfers }), [lines, transfers]);
}
