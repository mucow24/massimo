import type { LineId, Rotation, Station, StationId } from './types';

/**
 * After a line's station list changes, re-pick each station's rotation so the
 * line travels through it cleanly. Each station's local +y points along the
 * line's world travel direction at that station.
 *
 * Skips stations that carry other lines' stops too — those are transfer hubs
 * where the user has presumably set rotation deliberately, and clobbering it
 * from one of the participating lines would just thrash.
 */
export function autoOrientLineStops(
  stationsIn: Record<StationId, Station>,
  lineId: LineId,
  lineStations: StationId[],
): Record<StationId, Station> {
  if (lineStations.length < 2) return stationsIn;
  const out = { ...stationsIn };
  for (let i = 0; i < lineStations.length; i++) {
    const sid = lineStations[i];
    const st = out[sid];
    if (!st) continue;
    if (st.stops.some((c) => c.lineId !== lineId)) continue;
    const prev = i > 0 ? out[lineStations[i - 1]] : null;
    const next = i < lineStations.length - 1 ? out[lineStations[i + 1]] : null;
    if (!prev && !next) continue;
    let wx = 0;
    let wy = 0;
    if (prev && next) {
      const ix = st.x - prev.x;
      const iy = st.y - prev.y;
      const ox = next.x - st.x;
      const oy = next.y - st.y;
      const inN = Math.hypot(ix, iy) || 1;
      const outN = Math.hypot(ox, oy) || 1;
      wx = ix / inN + ox / outN;
      wy = iy / inN + oy / outN;
    } else if (prev) {
      wx = st.x - prev.x;
      wy = st.y - prev.y;
    } else if (next) {
      wx = next.x - st.x;
      wy = next.y - st.y;
    }
    if (wx === 0 && wy === 0) continue;
    // Rotation r ∈ 0..7 such that local +y, after rotation, points along
    // (wx, wy). Derivation: rotateBy((0,1), r·π/4) = (−sin a, cos a); set
    // that equal to the unit travel vector and solve.
    const theta = Math.atan2(wy, wx);
    const r = (((Math.round((4 * theta) / Math.PI - 2) % 8) + 8) % 8) as Rotation;
    if (st.rotation === r) continue;
    out[sid] = { ...st, rotation: r };
  }
  return out;
}
