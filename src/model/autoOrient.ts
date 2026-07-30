import { add, norm, sub } from '../geometry/vec';
import type { Rotation, Station, StationId } from './types';

/** Rotation 0..7 whose local +y, once applied, points along world vector (wx, wy). */
function tangentRotation(wx: number, wy: number): Rotation {
  // Derivation: rotateBy((0,1), r·π/4) = (−sin a, cos a); set that equal to the
  // unit travel vector and solve for r.
  const theta = Math.atan2(wy, wx);
  return (((Math.round((4 * theta) / Math.PI - 2) % 8) + 8) % 8) as Rotation;
}

// Screen octants that render a label upside down: its glyphs come out rotated
// between 135° and 225° (octants 3, 4, 5). A label reads at screen octant
// (station.rotation + label.rotation) mod 8.
const LABEL_UPSIDE_DOWN = new Set<number>([3, 4, 5]);

// The same band as one CONTINUOUS interval, for a reading angle that is not
// quantized to an octant. Endpoints included, so a reading that lands exactly on
// 135° or 225° flips just as octants 3 and 5 do — which is what keeps a seat at
// an octant angle answering bit-identically either way. The epsilon absorbs the
// atan2 round-trip that leaves such a seat at 134.999999999999986.
const ANGLE_EPS = 1e-9;
const readsUpsideDown = (deg: number): boolean => {
  const a = ((deg % 360) + 360) % 360;
  return a >= 135 - ANGLE_EPS && a <= 225 + ANGLE_EPS;
};

/**
 * The station rotation for a world travel tangent, label kept right-side-up:
 * nearest octant whose local +y runs along (wx, wy), flipped 180° (same axis,
 * identical geometry) when that octant would render the label upside down.
 * The shared derivation behind `autoOrientNewStation` and the line-circle
 * binding (a bound station rides the circle at the tangent octant).
 *
 * `frameRad` is the angle the station's local frame ACTUALLY resolves at, when
 * that is not the octant — a CIRCLE-bound station's cells, and so the name that
 * shares their lattice, go through the ring frame, which is the true tangent and
 * up to 22.5° off the rounded octant (see `stationFrameRad`). The flip has to be
 * judged on the angle the name is PAINTED at or it fires early: at the worst
 * seat the octant reads 135° while the name reads 112.5°, so a drag along the
 * rim spins the name end-for-end while it is still plainly upright. It also
 * costs reach — flipping by the rounded angle can only ever paint inside a 180°
 * window, where the band itself leaves 270° free.
 *
 * Omit it off a ring, where the octant IS the frame and the two are the same
 * number. The flipped seat needs no separate handling: the frame tracks
 * `rotation`, so turning the octant 180° turns the painted reading 180° with it.
 */
export function uprightTangentRotation(
  wx: number,
  wy: number,
  labelRotation: Rotation,
  frameRad?: number,
): Rotation {
  const r = tangentRotation(wx, wy);
  const upsideDown =
    frameRad === undefined
      ? LABEL_UPSIDE_DOWN.has((r + labelRotation) % 8)
      : readsUpsideDown((frameRad * 180) / Math.PI + labelRotation * 45);
  return upsideDown ? (((r + 4) % 8) as Rotation) : r;
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
 *
 * A line's travel axis is symmetric under a 180° flip — orienting the station
 * to the tangent `r` or to `r + 4` puts the same stripe through the same
 * centered stop — so when the tangent would render the label upside down we
 * take the opposite rotation instead: identical geometry, right-side-up text.
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

  // Prefer a right-side-up label: if the tangent would land the label in the
  // upside-down band, flip 180° to the axis-equivalent rotation.
  const rot = uprightTangentRotation(wx, wy, st.label.rotation);
  return st.rotation === rot
    ? stationsIn
    : { ...stationsIn, [stationId]: { ...st, rotation: rot } };
}
