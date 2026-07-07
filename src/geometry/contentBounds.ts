import type { MapDoc } from '../model/types';
import type { LabelStyle } from './labelLayout';
import { stopHalfOf } from '../model/lineWidth';
import { effectiveStationLabelStyle } from '../model/transforms';
import {
  stationBoundaryRectsLocal,
  stationLocalToWorld,
  textLabelHitPolygon,
  type AABBRect,
} from './stationBoundary';
import { svgImageCorners } from './svgImage';

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
  const acc = (p: { x: number; y: number }): void => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };

  const baseStyle: LabelStyle = {
    fontSize: doc.labelFontSize,
    weight: doc.labelWeight,
    italic: doc.labelItalic,
    leading: doc.labelLeading,
    tracking: doc.labelTracking,
  };
  const stopHalf = stopHalfOf(doc.lines);

  for (const id in doc.stations) {
    const st = doc.stations[id];
    const b = stationBoundaryRectsLocal(st, effectiveStationLabelStyle(st, baseStyle), stopHalf);
    for (const p of b.cells) acc(stationLocalToWorld(st, p));
    if (b.label) for (const p of b.label) acc(stationLocalToWorld(st, p));
  }
  for (const id in doc.textLabels) {
    for (const p of textLabelHitPolygon(doc.textLabels[id])) acc(p);
  }
  for (const id in doc.polygons) {
    for (const p of doc.polygons[id].vertices) acc(p);
  }
  for (const id in doc.svgImages) {
    for (const p of svgImageCorners(doc.svgImages[id])) acc(p);
  }
  for (const id in doc.routeBullets) {
    const b = doc.routeBullets[id];
    acc({ x: b.x - b.size, y: b.y - b.size });
    acc({ x: b.x + b.size, y: b.y + b.size });
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
