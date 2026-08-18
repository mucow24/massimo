import { dashRenderLength, dashRenderWidth } from './dashSize';
import { dotSizeOverride } from './dotSize';
import { defaultDotDiameter, dotStrokeRadiusDeltas, isBlankDotStyle } from './dotStyle';
import { lineInterlineGapOf, lineLabelGapOf, lineWidthOf } from './lineWidth';
import { neighborsOf } from './lineTopology';
import { isStopEnd, type StopEnd } from './transferAnchors';
import { resolveTransferStyle } from './transferStyle';
import { resolveDotStyle, stationIsSingleton } from './transforms';
import type { DotStyle, Line, Station, StopCell, Transfer, TransferEnd } from './types';
import type { StopMetrics, StopMetricsFn } from '../geometry/labelLayout';
import { rotateBy, travelDirLocal } from '../geometry/orientation';
import type { Vec2 } from '../geometry/vec';

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

/** Shared empty list, so the common stop allocates nothing for its transfers. */
const NO_TRANSFERS: StopMetrics['transfers'] = [];

/**
 * The unit direction a transfer's BODY leaves `end`'s stop in, in the station's
 * LOCAL cell frame — or null unless `other` is a stop of the SAME station.
 *
 * Both cells then live in that one lattice, so the heading is a plain cell
 * delta needing no doc slice to place (`stopCenterAt` scales row/col
 * uniformly, so normalizing the raw delta gives the same unit vector). Any
 * other end — a different station, a free or hosted anchor, the station's own
 * anchor point — would need the world resolver and the lineCircles/anchors it
 * reads, which this lookup does not hold. The cap disc stands alone there.
 */
const bodyDir = (
  end: StopEnd,
  other: TransferEnd,
  stations: Record<string, Station | undefined>,
): Vec2 | null => {
  if (!isStopEnd(other) || !other.lineId || other.stationId !== end.stationId) return null;
  const stops = stations[end.stationId]?.stops;
  const from = stops?.find((s) => s.lineId === end.lineId);
  const to = stops?.find((s) => s.lineId === other.lineId);
  if (!from || !to) return null;
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? null : { x: dx / len, y: dy / len };
};

/**
 * Per-(station, line) transfer ends, built ONCE per source. Only ends naming a
 * specific stop count: an end with no `lineId`, or one bound to a transfer
 * anchor (free or station-hosted), sits at the station's own anchor point
 * rather than on a dot, so no stop's label should clear it. The two ends of a
 * transfer are indexed independently — one joining two stops of the SAME
 * station lands on each, and each reads the body heading for the OTHER.
 */
const transfersByStop = (
  transfers: Record<string, Transfer>,
  stations: Record<string, Station | undefined>,
): Map<string, StopMetrics['transfers']> => {
  const byStop = new Map<string, StopMetrics['transfers']>();
  for (const id in transfers) {
    const t = transfers[id];
    const r = transferCapRadius(t);
    for (const [end, other] of [
      [t.a, t.b],
      [t.b, t.a],
    ]) {
      if (!isStopEnd(end) || !end.lineId) continue;
      const entry = { r, dir: bodyDir(end, other, stations) };
      const key = stopKey(end.stationId, end.lineId);
      const list = byStop.get(key);
      if (list) list.push(entry);
      else byStop.set(key, [entry]);
    }
  }
  return byStop;
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
 * Everything the returned function closes over from `stations`, extracted so
 * two builds can be compared for CONTENT rather than for the identity of the
 * record they came from.
 *
 * There are exactly two such reads, and neither responds to a station MOVE:
 * `bodyDir` resolves a transfer's body heading from stop CELLS, and
 * `continuesOf` reduces neighbour world positions to two BOOLEANS via the sign
 * of a projection. Everything else `fn` needs arrives as an argument or comes
 * from `lines`.
 */
interface Derived {
  transfers: Map<string, StopMetrics['transfers']>;
  /** stopKey → the terminus-aware continuation bits. */
  continues: Map<string, StopMetrics['continues']>;
}

const derivedEqual = (a: Derived, b: Derived): boolean => {
  if (a.continues.size !== b.continues.size || a.transfers.size !== b.transfers.size) return false;
  for (const [k, v] of a.continues) {
    const o = b.continues.get(k);
    if (!o || o.plus !== v.plus || o.minus !== v.minus) return false;
  }
  for (const [k, v] of a.transfers) {
    const o = b.transfers.get(k);
    if (!o || o.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) {
      const p = v[i];
      const q = o[i];
      if (p.r !== q.r) return false;
      if (!p.dir !== !q.dir) return false;
      if (p.dir && q.dir && (p.dir.x !== q.dir.x || p.dir.y !== q.dir.y)) return false;
    }
  }
  return true;
};

/**
 * Last build, with the derived content it was built from.
 *
 * Two levels. The IDENTITY level is the fast path: the same three slices give
 * back the same function, which is what makes one build serve every canvas
 * consumer in a frame. The CONTENT level is what makes a drag cheap — a station
 * move mints a new `stations` record every pointermove, so the identity level
 * can never hit mid-gesture, and without the second level every
 * `StationHitArea`, `StationLabel` and `StationSilhouette` on the map
 * re-renders (they subscribe through `useStopMetrics`, inside StationView's
 * memo, so the memo cannot stop them). When the derived content matches, the
 * previous function is handed back and the cache re-binds to the new slice
 * identities, so the frame's first caller pays the comparison and the rest hit
 * level one.
 *
 * Handing back the OLD closure is sound precisely because {@link Derived} is
 * the whole of what it captured from `stations`: same content ⇒ same answers,
 * for the moved station as much as for any other. It only holds while that
 * closure resolves neighbours out of the CURRENT record, which is what the
 * `stations` box is for — see the box's own comment. `lines` must still match
 * by identity — `fn` reads it directly, per call, for every non-station field.
 */
let lastBuild: {
  src: StopMetricsSource;
  fn: StopMetricsFn;
  derived: Derived;
  stations: { current: Record<string, Station | undefined> };
} | null = null;

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
 * The build is cached on the IDENTITY of the three slices, then on their
 * derived CONTENT (see `lastBuild`), which is sound because every producer of
 * them is a pure transform — a doc edit yields new objects. A caller that
 * mutated a slice in place would get the stale answer, but that caller is
 * already breaking the same-reference-on-no-op rule the whole render pipeline
 * memoizes on.
 */
export const stopMetricsOf = (src: StopMetricsSource): StopMetricsFn => {
  const hit = cachedBuild(src);
  if (hit) return hit;
  const transfers = transfersByStop(src.transfers, src.stations);
  // The record `continuesOf` resolves neighbour positions out of — a BOX, not
  // `src.stations` directly, because the content level below hands the previous
  // `fn` back by reference and it is then invoked with stations from the NEW
  // record. Projecting a station's new position against its neighbours' old
  // ones is a frame mismatch no comparison can catch: a rigid group move or
  // rotate preserves every projection, so `derivedEqual` passes while the mix
  // flips signs. The reuse branch re-points the box, so the surviving closure
  // always reads the record its callers are handing it stations from.
  const stations = { current: src.stations };
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
        const n = stations.current[id];
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
      transfers: transfers.get(stopKey(station.id, stop.lineId)) ?? NO_TRANSFERS,
      continues: continuesOf(station, stop, line),
    };
  };

  // The content level. `continues` is resolved eagerly for every stop the
  // document holds — the same walk `continuesOf` does lazily, ~2 projections
  // per stop — so this build can be compared with the last one.
  //
  // It is a comparison pass, not a replacement: `fn` keeps computing
  // `continues` live from the station it is HANDED, which is what keeps the
  // reuse honest for a caller passing a station the record does not contain.
  // There is one — `StationPlacingPreview` renders the drag ghost through
  // StationView with a synthetic `__placing_preview__` station — and it is
  // doubly safe: that station carries no stops, so this lookup is never
  // invoked for it at all.
  const derived: Derived = { transfers, continues: new Map() };
  for (const id in src.stations) {
    const st = src.stations[id];
    if (!st) continue;
    for (const stop of st.stops) {
      derived.continues.set(
        stopKey(id, stop.lineId),
        continuesOf(st, stop, src.lines[stop.lineId]),
      );
    }
  }
  const prev = lastBuild;
  if (prev && prev.src.lines === src.lines && derivedEqual(prev.derived, derived)) {
    // Re-bind to the new identities so the rest of this frame's callers take
    // the identity path, and hand back the function they already hold.
    prev.stations.current = src.stations;
    lastBuild = { src, fn: prev.fn, derived: prev.derived, stations: prev.stations };
    return prev.fn;
  }
  lastBuild = { src, fn, derived, stations };
  return fn;
};
