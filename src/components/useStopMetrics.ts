import { stopMetricsOf } from '../model/stopMetrics';
import { useDoc } from '../state/store';
import type { StopMetricsFn } from '../geometry/labelLayout';

/**
 * The per-stop metrics every station-geometry consumer on the canvas must share
 * — the painted label, its hit rect, and its selection silhouette all derive
 * from the same lookup or they drift apart (see `StopMetrics`).
 *
 * `stopMetricsOf` IS the selector. Two things follow from that, and both are
 * the point.
 *
 * First, the build happens inside the selector, which is where zustand can act
 * on it. This hook runs once per STATION component (hit rect, label,
 * silhouette, layout editor) — around a thousand instances on a dense map —
 * and it is called from inside `StationView`, so its subscription re-renders
 * them all whatever that memo says. Subscribing to `stations` directly
 * therefore re-rendered every station on every pointermove of a drag, to
 * produce identical output: a move changes no stop cell and flips no
 * `continues` bit. `stopMetricsOf` is reference-stable across a content-equal
 * rebuild, so `useSyncExternalStoreWithSelector`'s `Object.is` compare bails
 * and nothing re-renders — the frame's first caller pays one content
 * comparison and the rest take the identity path inside the cache. A real edit
 * (a stop re-celled, a transfer added, a neighbour dragged past a terminus)
 * mints a fresh function and everything re-renders as before.
 *
 * Second, the doc slice is read here rather than passed in. `DocState`
 * structurally satisfies `StopMetricsSource`, so the selector is a module-level
 * constant instead of a closure minted per render per component. It also
 * closes a trap: the cache behind `stopMetricsOf` holds ONE entry, so a caller
 * that handed in a `lines` object which was not the store's would miss on every
 * station on every frame — and now that the cache is what keeps the canvas from
 * re-rendering, that miss would cost re-renders, not just rebuilds. There is no
 * way to hand one in.
 */
export function useStopMetrics(): StopMetricsFn {
  return useDoc(stopMetricsOf);
}
