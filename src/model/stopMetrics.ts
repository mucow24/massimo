import { dashRenderLength, dashRenderWidth } from './dashSize';
import { dotSizeOverride } from './dotSize';
import { defaultDotDiameter, dotStrokeRadiusDeltas, isBlankDotStyle } from './dotStyle';
import { lineInterlineGapOf, lineLabelGapOf, lineWidthOf } from './lineWidth';
import { neighborsOf } from './lineTopology';
import { isStopEnd } from './transferAnchors';
import { resolveTransferStyle } from './transferStyle';
import { resolveDotStyle, stationIsSingleton } from './transforms';
import type { DotStyle, Line, Station, StopCell, Transfer } from './types';
import type { StopMetrics, StopMetricsFn } from '../geometry/labelLayout';
import { rotateBy, travelDirLocal } from '../geometry/orientation';

/**
 * The doc slice `stopMetricsOf` resolves against. A `MapDoc` satisfies it
 * structurally, so doc-holding call sites pass the doc itself while component
 * ones assemble `{ lines, transfers }` from their props/store reads.
 */
export interface StopMetricsSource {
  lines: Record<string, Line | undefined>;
  transfers: Record<string, Transfer>;
  // Needed only to resolve `continues` (neighbour world positions); every
  // production site holds the full station record anyway.
  stations: Record<string, Station | undefined>;
}

/**
 * Radius of the disc a transfer paints where it meets a stop.
 *
 * `TransferLayer` strokes the body at `thickness` over a halo at
 * `thickness + 2*strokeWidth`, both `stroke-linecap="round"` — so the painted
 * shape is a capsule of uniform half-width, and at either end it is exactly a
 * disc of that half-width. Isotropic, so unlike the dot it needs no direction.
 */
const transferCapRadius = (t: Transfer): number => {
  const style = resolveTransferStyle(t);
  return (style.thickness + 2 * style.strokeWidth) / 2;
};

const stopKey = (stationId: string, lineId: string): string => `${stationId} ${lineId}`;

/**
 * Per-(station, line) largest transfer cap, built ONCE per source. Only ends
 * naming a specific stop count: an end with no `lineId`, or one bound to a
 * transfer anchor (free or station-hosted), sits at the station's own anchor
 * point rather than on a dot, so no stop's label should clear it. The two ends
 * of a transfer are indexed independently — one joining two stops of the SAME
 * station contributes a cap to each.
 */
const transferCapsByStop = (transfers: Record<string, Transfer>): Map<string, number> => {
  const caps = new Map<string, number>();
  for (const id in transfers) {
    const t = transfers[id];
    const r = transferCapRadius(t);
    for (const end of [t.a, t.b]) {
      if (!isStopEnd(end) || !end.lineId) continue;
      const key = stopKey(end.stationId, end.lineId);
      const prev = caps.get(key);
      if (prev === undefined || r > prev) caps.set(key, r);
    }
  }
  return caps;
};

/**
 * The OUTER silhouette radius of a painted stop dot, in the same `r` units
 * `StopGlyph` draws with — the circumscribing radius for a circle or square,
 * the vertex distance for a diamond. A radius only; which AXES a polygon dot's
 * edges align to is the geometry's problem (they are the world's — see
 * `dotSupport` in labelLayout.ts).
 *
 * The stroke's contribution comes from `dotStrokeRadiusDeltas`, the same owner
 * `StopGlyph` paints its silhouette pass at, so the radius a label clears and
 * the radius the canvas draws cannot drift. Hover's 3px affordance never
 * reaches here — it is transient chrome the painter applies on its own side,
 * and a label that shifted on mouseover would be a bug.
 */
const dotOuterRadius = (r: number, style: DotStyle): number =>
  r + dotStrokeRadiusDeltas(style.strokeWidth, style.shape, style.strokeAlign).silhouette;

/**
 * Last build, keyed by the identity of the three slices it reads. The builder
 * is pure and its result is deterministic, so handing back the previous
 * function is invisible to callers — the same module-level-cache bargain
 * `measureTextLabel` makes, and for the same reason: this runs once per STATION
 * component on the canvas (see `useStopMetrics`), while the eager transfer
 * index inside costs O(transfers) per build. One entry is enough because every
 * canvas consumer reads the same three slices from the same store, so they all
 * miss and all hit together.
 */
let lastBuild: { src: StopMetricsSource; fn: StopMetricsFn } | null = null;

const cachedBuild = (src: StopMetricsSource): StopMetricsFn | null => {
  const prev = lastBuild;
  return prev &&
    prev.src.lines === src.lines &&
    prev.src.transfers === src.transfers &&
    prev.src.stations === src.stations
    ? prev.fn
    : null;
};

/**
 * Everything the label geometry needs about one painted stop, resolved through
 * the same helpers the canvas paints by. THE production `StopMetricsFn` — pass
 * it at every `labelLayoutLocal` / `stationBoundary` / `itemBounds` site (see
 * `StopMetrics` for why the fields have to travel together).
 *
 * The dot radius follows `resolveDotRender`'s own rule: an explicit
 * `dotSizeOverride` halved, else the STYLE's tracking diameter (12 for a
 * service-code disc, 8 otherwise) halved — never `resolveDotSize`, which would
 * be right for display but hides which of the two applied. A blank style paints
 * nothing, and a `'dash'` paints a tick rather than a dot: that one is already
 * described by `dash`, and counting it here too would clear it twice.
 *
 * The build is cached on the IDENTITY of the three slices (see `lastBuild`),
 * which is sound because every producer of them is a pure transform — a doc
 * edit yields new objects. A caller that mutated a slice in place would get the
 * stale answer, but that caller is already breaking the same-reference-on-no-op
 * rule the whole render pipeline memoizes on.
 */
export const stopMetricsOf = (src: StopMetricsSource): StopMetricsFn => {
  const hit = cachedBuild(src);
  if (hit) return hit;
  const caps = transferCapsByStop(src.transfers);
  // Which signed halves of the stop's travel axis carry line body away from
  // the station: project each edge-neighbour's world delta onto the canonical
  // world axis. A perpendicular neighbour (the line bends away AT the
  // station) counts on neither side — its body is not the along-axis stripe
  // the beside-slant window models. Orphan or edge-less stops continue
  // nowhere: the finite marker square is all that paints.
  const continuesOf = (
    station: Station,
    stop: StopCell,
    line: Line | undefined,
  ): StopMetrics['continues'] => {
    let plus = false;
    let minus = false;
    if (line) {
      const axis = rotateBy(travelDirLocal(stop.orientation), station.rotation);
      for (const id of neighborsOf(line, station.id)) {
        const n = src.stations[id];
        if (!n) continue;
        const proj = (n.x - station.x) * axis.x + (n.y - station.y) * axis.y;
        if (proj > 1e-6) plus = true;
        else if (proj < -1e-6) minus = true;
      }
    }
    return { plus, minus };
  };
  const fn: StopMetricsFn = (station: Station, stop: StopCell): StopMetrics => {
    const line = src.lines[stop.lineId];
    // Singleton vs. shared drives both the dot STYLE and the dot SIZE default,
    // and resolving it walks the station's stops — so once, not once each.
    const singleton = stationIsSingleton(station);
    const style = resolveDotStyle(line, stop, singleton);
    const isDash = style.shape === 'dash';
    const override = dotSizeOverride(line, stop, singleton);
    const baseR = override !== undefined ? override / 2 : defaultDotDiameter(style) / 2;
    return {
      half: lineWidthOf(line) / 2,
      gap: lineInterlineGapOf(line),
      labelGap: lineLabelGapOf(line),
      dash: isDash ? { length: dashRenderLength(line), width: dashRenderWidth(line) } : null,
      dot:
        isDash || isBlankDotStyle(style)
          ? null
          : { r: dotOuterRadius(baseR, style), shape: style.shape },
      transferRadius: caps.get(stopKey(station.id, stop.lineId)) ?? 0,
      continues: continuesOf(station, stop, line),
    };
  };
  lastBuild = { src, fn };
  return fn;
};
