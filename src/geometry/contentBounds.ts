import type { MapDoc } from '../model/types';
import { stopHalfOf } from '../model/lineWidth';
import { stopDashOf } from '../model/dashSize';
import { effectiveStationLabelStyle } from '../model/transforms';
import { TEXT_LABEL_HIT_PAD, type AABBRect } from './stationBoundary';
import {
  polygonAABB,
  routeBulletAABB,
  stationWorldAABB,
  svgImageAABB,
  textLabelAABB,
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

  const stopHalf = stopHalfOf(doc.lines);
  const stopDash = stopDashOf(doc.lines);

  for (const id in doc.stations) {
    const st = doc.stations[id];
    acc(stationWorldAABB(st, effectiveStationLabelStyle(st), stopHalf, stopDash));
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

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
