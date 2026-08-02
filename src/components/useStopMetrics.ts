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
 * The build happens INSIDE the selector, and that placement is the whole point.
 * This hook runs once per STATION component (hit rect, label, silhouette,
 * layout editor) — around a thousand instances on a dense map — and it is
 * called from inside `StationView`, so its subscription re-renders them all
 * whatever that memo says. Subscribing to `stations` directly therefore
 * re-rendered every station on every pointermove of a drag, to produce
 * identical output: a move changes no stop cell and flips no `continues` bit.
 *
 * Selecting the LOOKUP instead of the slices puts the decision where zustand
 * can act on it. `stopMetricsOf` is reference-stable across a content-equal
 * rebuild, so `useSyncExternalStoreWithSelector`'s `Object.is` compare bails
 * and nothing re-renders; the frame's first caller pays one content
 * comparison and the rest take the identity path inside the cache. A real
 * edit — a stop re-celled, a transfer added, a neighbour dragged past a
 * terminus — mints a fresh function and everything re-renders as before.
 */
export function useStopMetrics(lines: Record<string, Line>): StopMetricsFn {
  return useDoc((s) => stopMetricsOf({ lines, transfers: s.transfers, stations: s.stations }));
}
