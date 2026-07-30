import type { Station, StopCell } from '../model/types';
import { dashRenderLength, dashRenderWidth } from '../model/dashSize';
import { lineWidthOf } from '../model/lineWidth';
import { dot, leftNormal, type Vec2 } from './vec';
import {
  rotateBy,
  stationCellToWorld,
  stationDirToWorld,
  stopCenterAt,
  travelDirLocal,
} from './orientation';

// TfL-style tick geometry for one 'dash' stop. Every dash stop is a
// SINGLETON: it knows only its own stripe (center + width) and the station
// label — no band or neighbor-chain context. On interlined stations the
// composite "notched" tick is emergent: tangent stops' ticks abut exactly
// because the derived length equals one line width (see dashSize.ts), and
// StationDots stacks overlaps by painting the tick nearest the label last.

// Below this perpendicular distance (world units) the label reads as ON the
// travel axis and the deterministic fallback side kicks in.
const SIDE_EPS = 1e-6;

export interface DashSpec {
  // World anchor: the point on the stop's own stripe edge (label side) where
  // the tick begins; the rect extends `length` along `angleDeg` from here.
  ax: number;
  ay: number;
  // World angle (degrees, y-down CW) of the outward direction, stripe → label.
  angleDeg: number;
  // Protrusion length (outward) and thickness (along travel), world units.
  length: number;
  width: number;
  // Perpendicular distance from the stop center to the label anchor, local
  // units. The paint-order key: SMALLER = nearer the label = paints LATER.
  labelDist: number;
}

/**
 * The station label's anchor point in the unrotated station-local frame:
 * cell center + offset along the reading direction + offsetPerp across it —
 * the exact composition labelLayoutLocal paints with, so the tick side always
 * follows the label the user actually sees (offset fine-drags included).
 */
function labelAnchorLocal(station: Station): Vec2 {
  const label = station.label;
  const base = stopCenterAt(label.row, label.col);
  const readAngle = (label.rotation * Math.PI) / 4;
  const readCos = Math.cos(readAngle);
  const readSin = Math.sin(readAngle);
  const offsetPerp = label.offsetPerp ?? 0;
  return {
    x: base.x + label.offset * readCos + offsetPerp * -readSin,
    y: base.y + label.offset * readSin + offsetPerp * readCos,
  };
}

/**
 * Unit outward direction of a dash stop's tick — from the stripe edge toward
 * the label — in the unrotated station-local frame. `labelMinusStop` is the
 * label ANCHOR minus the stop center, local px (offset-aware: cell + the
 * offset/offsetPerp composition labelLayoutLocal paints with). Shared by the
 * tick renderer (dashSpec) and the autoAlign label clearance (labelLayout)
 * so the two can never disagree about which side the tick is on.
 */
export function dashOutward(
  labelMinusStop: Vec2,
  orientation: StopCell['orientation'],
  stationRotation: Station['rotation'],
): Vec2 {
  // A tick is 180°-symmetric about the travel axis, so the hint-free axis is
  // enough (same argument as the marker squares, buildStopMarkers).
  const travel = travelDirLocal(orientation);
  const perpAxis = leftNormal(travel);
  const s = dot(labelMinusStop, perpAxis);

  let sign: 1 | -1;
  if (Math.abs(s) > SIDE_EPS) {
    sign = s > 0 ? 1 : -1;
  } else {
    // Label on the travel axis: fall back to the typographic default side —
    // "label above the line" (negative world y), or negative world x when
    // the perpendicular is exactly horizontal. Evaluated in WORLD space so
    // the fallback reads the same regardless of station rotation.
    const wp = rotateBy(perpAxis, stationRotation);
    sign = wp.y < -SIDE_EPS || (Math.abs(wp.y) <= SIDE_EPS && wp.x < 0) ? 1 : -1;
  }
  return { x: perpAxis.x * sign, y: perpAxis.y * sign };
}

/**
 * Tick geometry for one dash stop, in world coordinates. Pure and
 * measure-free: the label side derives from the label ANCHOR (cell +
 * offsets), never the painted text bbox, so there is no text-measurement
 * dependency and no label↔tick layout cycle.
 *
 * `line` is the stop's owning line (structural: width + dash dims); undefined
 * falls back to the global defaults, mirroring the other per-line lookups.
 */
export function dashSpec(
  station: Station,
  cell: StopCell,
  line: { width?: number; dashLength?: number; dashWidth?: number } | null | undefined,
  // The ring the station is bound to, or null. A tick is placed off its own
  // stop, so it has to resolve through the SAME frame the stop does — see
  // `stationFrameRad`. Passing null for a bound station would slide every tick
  // off its dot.
  circle: { x: number; y: number } | null,
): DashSpec {
  const stopLocal = stopCenterAt(cell.row, cell.col);
  const labelLocal = labelAnchorLocal(station);
  const delta = { x: labelLocal.x - stopLocal.x, y: labelLocal.y - stopLocal.y };
  const out = dashOutward(delta, cell.orientation, station.rotation);
  const half = lineWidthOf(line) / 2;
  const anchor = stationCellToWorld(
    { x: stopLocal.x + out.x * half, y: stopLocal.y + out.y * half },
    station,
    circle,
  );
  const outWorld = stationDirToWorld(out, station, circle);
  return {
    ax: anchor.x,
    ay: anchor.y,
    angleDeg: (Math.atan2(outWorld.y, outWorld.x) * 180) / Math.PI,
    length: dashRenderLength(line),
    width: dashRenderWidth(line),
    // |perp distance to the label| — dot(delta, out) is that distance made
    // non-negative, since `out` is the perp axis signed toward the label.
    labelDist: Math.abs(dot(delta, out)),
  };
}
