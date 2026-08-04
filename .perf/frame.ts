import {
  buildBandGeometry,
  buildStopMarkers,
  withLinePriorities,
} from '../src/geometry/interlining';
import { buildExclusionHolesCached, resolveRegionWinners } from '../src/geometry/lineRegions';
import { regionsFor } from '../src/geometry/regionCache';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../src/model/lineStroke';
import { lineWidthOf } from '../src/model/lineWidth';
import type { MapDoc, Station, StationId } from '../src/model/types';

/**
 * One pointermove's worth of MapCanvas memo work, mirroring its memo chain
 * (MapCanvas.tsx):
 *   bandsGeometry -> bands(withLinePriorities) -> stopMarkers
 *   -> regionGeom(regionsFor, transient) -> regionWinners -> regionExcludeHoles
 *
 * Every harness's validity rests on this staying a faithful mirror, so it lives
 * in one place: it was copy-pasted into six bench files, each free to drift out
 * of that claim on its own. Returns the face count for the callers that report
 * it; the rest ignore it.
 *
 * dragPerf.perf.test.ts keeps its own copy on purpose — that one is instrumented
 * with per-phase timers and returns a FrameCost, which is the whole point of it.
 */
export function runFrame(doc: MapDoc, stations: Record<StationId, Station>): number {
  const g = { stations, lines: doc.lines, lineCircles: doc.lineCircles };
  const bandsGeometry = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const bands = withLinePriorities(bandsGeometry, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, bands, doc.lineCircles);
  const geom = regionsFor(g, { bands: bandsGeometry, markers }, { transient: true });
  const winners = resolveRegionWinners(geom.faces, doc.regionAssignments, geom.bands, doc.lineOrder);
  buildExclusionHolesCached(
    geom.faces,
    winners,
    doc.lineOrder,
    geom.bands,
    geom.markers,
    (lineId) => {
      const line = doc.lines[lineId];
      return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
    },
    geom.slivers,
    geom.holeChain,
  );
  return geom.faces.length;
}
