import type { MapDoc } from '../model/types';
import { stopMetricsOf } from '../model/stopMetrics';
import { effectiveStationLabelStyle } from '../model/transforms';
import { TEXT_LABEL_HIT_PAD, type AABBRect } from './stationBoundary';
import {
  polygonAABB,
  routeBulletAABB,
  stationWorldAABB,
  svgImageAABB,
  textLabelAABB,
  transferAnchorAABB,
} from './itemBounds';
import type { AABB } from './rectPolygon';

/**
 * World-space axis-aligned bounding box of every visible thing on the map —
 * stations (stop cells + rotated label rect), text labels, polygons, svg
 * images, and route bullets — or `null` when the map has no content. This is
 * the pure, model-only analogue of the DOM `getBBox` the exporter uses: it
 * reuses the exact per-item boundary helpers the marquee/hit-test path relies
 * on, so it never needs the canvas rendered. Lines are omitted deliberately —
 * their vertices are station positions, so a straight run stays inside the
 * station hull the boxes above already cover (a slight bezier bulge is absorbed
 * by the fit margin).
 *
 * Used to point the camera at freshly loaded content (see `fitViewport`).
 */
export function computeContentBounds(doc: MapDoc): AABBRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (r: AABB): void => {
    if (r.x0 < minX) minX = r.x0;
    if (r.x1 > maxX) maxX = r.x1;
    if (r.y0 < minY) minY = r.y0;
    if (r.y1 > maxY) maxY = r.y1;
  };

  const metrics = stopMetricsOf(doc);

  for (const id in doc.stations) {
    const st = doc.stations[id];
    acc(stationWorldAABB(st, effectiveStationLabelStyle(st), metrics));
  }
  for (const id in doc.textLabels) {
    acc(textLabelAABB(doc.textLabels[id], TEXT_LABEL_HIT_PAD));
  }
  for (const id in doc.polygons) {
    acc(polygonAABB(doc.polygons[id].vertices));
  }
  for (const id in doc.svgImages) {
    acc(svgImageAABB(doc.svgImages[id]));
  }
  for (const id in doc.routeBullets) {
    acc(routeBulletAABB(doc.routeBullets[id]));
  }
  // FREE transfer anchors only. Unlike a transfer (safely omitted, because its
  // ENDS are stations the hull already spans), a free anchor is a user-placed
  // world point nothing else covers — leave it out and Reset view scrolls it
  // off-screen with no way back. Deliberately NOT gated on `showAnchors`: this
  // is a pure doc function with no viewport access, and it already ignores
  // `showNetwork` for stations, so a toggle-sensitive kind would be the worse
  // inconsistency. Hosted anchors stay out: they're chrome anchored to a station
  // the hull already spans, and are normally within its footprint. (The station
  // AABB does not literally enclose an anchor cell parked outside the stops+label
  // box; framing may clip such an outlier, which is acceptable for chrome.)
  for (const id in doc.transferAnchors) {
    acc(transferAnchorAABB(doc.transferAnchors[id]));
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
