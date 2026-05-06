import type { Line, LineId, Station, StationId } from '../model/types';
import type { SnapGuide } from './snap';
import { STOP_SIZE } from './orientation';

export interface SnapBulletInput {
  x: number;
  y: number;
  line: Line;
  stations: Record<StationId, Station>;
  tolerance: number;
}

export interface SnapBulletResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// World position of a station's stop on the given line.
function stopWorldOnLine(st: Station, lineId: LineId): { x: number; y: number } | null {
  const cell = st.stops.find((c) => c.lineId === lineId);
  if (!cell) return null;
  const a = (st.rotation * Math.PI) / 4;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const lx = cell.col * STOP_SIZE;
  const ly = cell.row * STOP_SIZE;
  return { x: st.x + lx * cs - ly * sn, y: st.y + lx * sn + ly * cs };
}

/**
 * Snap a free-floating route bullet to be axis-aligned with its own line.
 *
 * Bullets sit ALONGSIDE the line, not on it. The snap pins the perpendicular
 * coordinate of the bullet (relative to the local line direction) to the
 * line's path while leaving the parallel coordinate free — i.e., a vertical
 * line snaps the bullet's x but preserves its y, so the bullet can be
 * positioned above, below, or alongside the line at any height.
 *
 * Algorithm:
 *  1. For each segment of the line (consecutive stations), measure the
 *     perpendicular distance from the bullet to the INFINITE line through
 *     that segment (no t-clamp — the bullet may be beyond the segment's
 *     endpoints and still want to align).
 *  2. Filter to candidates within `tolerance`.
 *  3. Pick the candidate with the smallest perpendicular distance, breaking
 *     ties in favor of segments where the bullet's parallel projection
 *     lands inside the segment (so the user gets the segment they're
 *     "between" rather than an arbitrary parallel one).
 *  4. Snap the bullet by projecting onto the chosen segment's infinite
 *     line. Emit guides from the snapped position to each of the segment's
 *     two endpoints, labeled with the distance.
 */
export function snapBullet(input: SnapBulletInput): SnapBulletResult {
  const { x, y, line, stations, tolerance } = input;

  type Cand = {
    aw: { x: number; y: number };
    bw: { x: number; y: number };
    ux: number;
    uy: number;
    perpDist: number;
    s: number; // signed parallel distance from aw along (ux, uy)
    segLen: number;
  };
  const cands: Cand[] = [];
  for (let i = 0; i < line.stations.length - 1; i++) {
    const sa = stations[line.stations[i]];
    const sb = stations[line.stations[i + 1]];
    if (!sa || !sb) continue;
    const aw = stopWorldOnLine(sa, line.id);
    const bw = stopWorldOnLine(sb, line.id);
    if (!aw || !bw) continue;
    const dx = bw.x - aw.x;
    const dy = bw.y - aw.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) continue;
    const ux = dx / segLen;
    const uy = dy / segLen;
    // Perpendicular axis (rotate +90°): (-uy, ux).
    const px = -uy;
    const py = ux;
    const perpDist = Math.abs((x - aw.x) * px + (y - aw.y) * py);
    if (perpDist > tolerance) continue;
    const s = (x - aw.x) * ux + (y - aw.y) * uy;
    cands.push({ aw, bw, ux, uy, perpDist, s, segLen });
  }
  if (cands.length === 0) return { x, y, guides: [] };

  // Prefer candidates where the parallel projection lies inside the segment.
  cands.sort((a, b) => {
    const aInside = a.s >= 0 && a.s <= a.segLen ? 0 : 1;
    const bInside = b.s >= 0 && b.s <= b.segLen ? 0 : 1;
    if (aInside !== bInside) return aInside - bInside;
    return a.perpDist - b.perpDist;
  });
  const best = cands[0];
  const sx = best.aw.x + best.s * best.ux;
  const sy = best.aw.y + best.s * best.uy;
  const dPrev = Math.hypot(sx - best.aw.x, sy - best.aw.y);
  const dNext = Math.hypot(sx - best.bw.x, sy - best.bw.y);
  return {
    x: sx,
    y: sy,
    guides: [
      { from: { x: sx, y: sy }, to: best.aw, label: Math.round(dPrev).toString() },
      { from: { x: sx, y: sy }, to: best.bw, label: Math.round(dNext).toString() },
    ],
  };
}
