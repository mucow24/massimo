import { dashRenderLength, dashRenderWidth } from './dashSize';
import { dotSizeOverride } from './dotSize';
import { defaultDotDiameter, isBlankDotStyle } from './dotStyle';
import { lineInterlineGapOf, lineLabelGapOf, lineWidthOf } from './lineWidth';
import { isStopEnd } from './transferAnchors';
import { resolveTransferStyle } from './transferStyle';
import { resolveDotStyle, stationIsSingleton } from './transforms';
import type { DotStyle, Line, Station, StopCell, Transfer } from './types';
import type { StopMetrics, StopMetricsFn } from '../geometry/labelLayout';

/**
 * The doc slice `stopMetricsOf` resolves against. A `MapDoc` satisfies it
 * structurally, so doc-holding call sites pass the doc itself while component
 * ones assemble `{ lines, transfers }` from their props/store reads.
 */
export interface StopMetricsSource {
  lines: Record<string, Line | undefined>;
  transfers: Record<string, Transfer>;
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
 * Mirrors StopGlyph's `silDelta` exactly: a stroke widens the painted
 * silhouette by `strokeWidth/2` for each side it sits outside the edge, and a
 * diamond needs √2× the RADIUS delta to move its edges by that much (its edges
 * are only r/√2 from the center). `inside` pins the outer edge, `center`
 * straddles it, `outside` grows from it. Hover's 3px affordance is deliberately
 * excluded — it is transient chrome, and a label that shifted on mouseover
 * would be a bug.
 */
const dotOuterRadius = (r: number, style: DotStyle): number => {
  if (!(style.strokeWidth > 0)) return r;
  const h = style.strokeWidth / 2;
  // 'x' is concave, so StopGlyph always strokes it centered whatever the style says.
  const align = style.shape === 'x' ? 'center' : style.strokeAlign;
  const off = style.shape === 'diamond' ? h * Math.SQRT2 : h;
  return r + (align === 'inside' ? 0 : align === 'outside' ? 2 * off : off);
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
 */
export const stopMetricsOf = (src: StopMetricsSource): StopMetricsFn => {
  const caps = transferCapsByStop(src.transfers);
  return (station: Station, stop: StopCell): StopMetrics => {
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
    };
  };
};
