/**
 * Sig-keyed cache for region geometry, shared by the render layer and the
 * store's reconcile step so neither rebuilds what the other just computed.
 * Reconciliation needs faces for BOTH the pre-edit and post-edit geometry;
 * the pre-edit entry usually fell out of any per-render memo, so this cache
 * is the one place both sides read.
 */
import type { Line, LineId, Station, StationId } from '../model/types';
import {
  buildBandGeometry,
  buildStopMarkers,
  type SegmentBandSpec,
  type StopMarkerSpec,
} from './interlining';
import { buildOverlapRegions, type RegionFace } from './lineRegions';

export interface GeometrySlice {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
}

/**
 * Hash of everything region geometry depends on: station positions/rotations
 * and stop cells, line edge sets, widths and curve radii, and segment style
 * VALUES (they flip marker footprints between full-square and stub/none).
 * Deliberately excludes colors, casing, seams, lineOrder — presentation.
 */
export function regionGeometrySig(g: GeometrySlice): string {
  const parts: string[] = [];
  for (const id of Object.keys(g.stations)) {
    const st = g.stations[id];
    if (!st.stops.length) continue; // stopless stations carry no band geometry
    parts.push(id, String(st.x), String(st.y), String(st.rotation));
    for (const c of st.stops) parts.push(c.lineId, String(c.row), String(c.col), c.orientation);
  }
  for (const id of Object.keys(g.lines)) {
    const ln = g.lines[id];
    if (!ln.edges.length) continue; // edgeless lines have no bands
    parts.push(id, ln.edges.join('.'), String(ln.width ?? ''), String(ln.curveRadius ?? ''));
    const styles = ln.segmentStyles;
    if (styles) for (const k of Object.keys(styles)) parts.push(k, styles[k]);
  }
  return parts.join('|');
}

export interface RegionGeometry {
  bands: SegmentBandSpec[];
  markers: StopMarkerSpec[];
  faces: RegionFace[];
}

const CACHE_LIMIT = 4;
const cache = new Map<string, RegionGeometry>();

/**
 * Bands + markers + overlap faces for a geometry slice. LRU-cached by sig
 * (small: render + reconcile old/new). Markers are built with an empty
 * lineOrder — their priority field is irrelevant to region geometry.
 */
export function regionsFor(g: GeometrySlice): RegionGeometry {
  const sig = regionGeometrySig(g);
  const hit = cache.get(sig);
  if (hit) {
    // Refresh recency.
    cache.delete(sig);
    cache.set(sig, hit);
    return hit;
  }
  const bands = buildBandGeometry(g.stations, g.lines);
  const markers = buildStopMarkers(g.stations, g.lines, [], bands);
  const faces = buildOverlapRegions(bands, markers);
  const entry: RegionGeometry = { bands, markers, faces };
  cache.set(sig, entry);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry;
}
