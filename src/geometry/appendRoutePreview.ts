import type { Line, LineId, MapDoc, Station, StationId } from '../model/types';
import {
  appendRoutePreviewEdges,
  decideStationClick,
  type AppendCursor,
} from '../model/appendGestures';
import { DEFAULT_DOC, connectStationsOnLine, spliceStationIntoEdge } from '../model/transforms';
import { buildBandGeometry, type SegmentBandSpec } from './interlining';

/** One band of the preview route, with the edited line's stripe inside it. */
export interface RoutePreviewStripe {
  band: SegmentBandSpec;
  /** Index of the edited line's stripe within `band`. */
  stripeIndex: number;
}

/**
 * The Edit Stops ROUTE preview: the corridors a click on the hovered station
 * would draw, as real band geometry.
 *
 * Rather than approximate the new corridor, this runs the ACTUAL click — the
 * same `connectStationsOnLine` / `spliceStationIntoEdge` transform the gesture
 * dispatches — over a scratch doc, then rebuilds bands from the result and
 * keeps the ones on the added corridors. So the preview inherits the stop-cell
 * spawn (a new stop on an interchange lands off the anchor), the auto-
 * orientation of a station gaining its first line, the fillet radius, and any
 * interlining with a line that already runs the corridor. It cannot promise a
 * shape the click doesn't deliver.
 *
 * The scratch doc exists only to satisfy the transforms' `(doc, …) → doc`
 * shape: they read `lines`/`stations` (and, for the splice, `lineTags` for its
 * orphan prune, which an empty record makes a no-op), and band geometry reads
 * nothing else — so a `DEFAULT_DOC` shell around the two live collections is
 * enough, and the paint layer doesn't have to thread the whole document down.
 *
 * Cost is one band rebuild, on the same order as a single geometry edit; it is
 * keyed on the hover target, which only changes when the pointer crosses onto
 * a different station.
 */
export function appendRoutePreviewStripes(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  lineId: LineId,
  cursor: AppendCursor,
  stationId: StationId,
  lineCircles: Record<string, import('../model/types').LineCircle> = {},
): RoutePreviewStripe[] {
  const line = lines[lineId];
  if (!line) return [];
  const added = appendRoutePreviewEdges(line, cursor, stationId);
  if (added.length === 0) return [];
  const doc: MapDoc = { ...DEFAULT_DOC, lines, stations, lineCircles };
  // `added` is non-empty, so the decision is a connect or a splice — the two
  // arms that put a station on the line.
  const d = decideStationClick(line, cursor, stationId);
  const next =
    d.kind === 'splice'
      ? spliceStationIntoEdge(doc, lineId, d.from, d.to, d.stationId)
      : d.kind === 'connect'
        ? connectStationsOnLine(doc, lineId, d.from, d.to)
        : doc;
  // Transforms return the same reference on no-op; nothing changed means
  // there is nothing to preview.
  if (next === doc) return [];
  const stripes: RoutePreviewStripe[] = [];
  for (const band of buildBandGeometry(next.stations, next.lines, next.lineCircles)) {
    if (!added.includes(band.pairKey)) continue;
    const stripeIndex = band.lines.findIndex((l) => l.id === lineId);
    if (stripeIndex >= 0) stripes.push({ band, stripeIndex });
  }
  return stripes;
}
