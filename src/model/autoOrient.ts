import { add, norm, sub } from '../geometry/vec';
import type { Rotation, Station, StationId } from './types';

/** Rotation 0..7 whose local +y, once applied, points along world vector (wx, wy). */
function tangentRotation(wx: number, wy: number): Rotation {
  // Derivation: rotateBy((0,1), r·π/4) = (−sin a, cos a); set that equal to the
  // unit travel vector and solve for r.
  const theta = Math.atan2(wy, wx);
  return (((Math.round((4 * theta) / Math.PI - 2) % 8) + 8) % 8) as Rotation;
}

/**
 * Orient the one station that was just added to a line so the line travels
 * cleanly through it — its local +y points along the line's world travel
 * direction at that station. Returns the dict unchanged if the station has no
 * neighbour on the line yet (a 1-station line) or already sits at the computed
 * rotation.
 *
 * Only the just-added station is touched. Stations already on the line keep the
 * rotation the user gave them: auto-orientation is a convenience for a station
 * gaining its first line, never a whole-line reflow.
 */
export function autoOrientNewStation(
  stationsIn: Record<StationId, Station>,
  lineStations: StationId[],
  stationId: StationId,
): Record<StationId, Station> {
  const i = lineStations.indexOf(stationId);
  const st = stationsIn[stationId];
  if (i === -1 || !st) return stationsIn;
  const prev = i > 0 ? stationsIn[lineStations[i - 1]] : null;
  const next = i < lineStations.length - 1 ? stationsIn[lineStations[i + 1]] : null;

  let wx = 0;
  let wy = 0;
  if (prev && next) {
    // Bisect the incoming and outgoing unit travel vectors.
    const bisector = add(norm(sub(st, prev)), norm(sub(next, st)));
    wx = bisector.x;
    wy = bisector.y;
  } else if (prev) {
    wx = st.x - prev.x;
    wy = st.y - prev.y;
  } else if (next) {
    wx = next.x - st.x;
    wy = next.y - st.y;
  } else {
    return stationsIn; // 1-station line: no tangent yet
  }
  if (wx === 0 && wy === 0) return stationsIn;

  const r = tangentRotation(wx, wy);
  return st.rotation === r ? stationsIn : { ...stationsIn, [stationId]: { ...st, rotation: r } };
}
