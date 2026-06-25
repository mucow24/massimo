import { stopPosWorld } from '../../geometry/interlining';
import type { Vec2 } from '../../geometry/vec';
import type { MapDoc, Station } from '../../model/types';

// Every station's stop-centers (its anchor when it has no stops). These are the
// "Snap to all" targets that represent stations. Shared by the polygon and
// svg-image drag hooks so both snap to the same station anchors.
export function stationStopCenters(stations: Record<string, Station>): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    if (st.stops.length === 0) {
      out.push({ x: st.x, y: st.y });
      continue;
    }
    for (const c of st.stops) out.push(stopPosWorld(c, st));
  }
  return out;
}

// Every polygon vertex, optionally excluding one whole polygon by id (used by a
// whole-polygon drag so a shape doesn't snap to its own vertices).
export function allPolygonVertices(polygons: MapDoc['polygons'], excludeId?: string): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(polygons)) {
    if (id === excludeId) continue;
    for (const v of polygons[id].vertices) out.push(v);
  }
  return out;
}
