import type { SnapGuide } from './snap';

export interface SnapBulletInput {
  x: number;
  y: number;
  // One polyline per band the line passes through. Each polyline is the
  // band's centerline (the rendered stripe path), so snap follows the
  // curved geometry — straight-line direction between stops doesn't match
  // the visual line at corners or at stations whose stop orientation
  // forces a specific tangent.
  polylines: { x: number; y: number }[][];
  tolerance: number;
}

export interface SnapBulletResult {
  x: number;
  y: number;
  guides: SnapGuide[];
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
  const { x, y, polylines, tolerance } = input;

  type Cand = {
    aw: { x: number; y: number };
    bw: { x: number; y: number };
    ux: number;
    uy: number;
    perpDist: number;
    s: number; // signed parallel distance from aw along (ux, uy)
    segLen: number;
    polylineIndex: number;
  };
  const cands: Cand[] = [];
  for (let pi = 0; pi < polylines.length; pi++) {
    const poly = polylines[pi];
    for (let i = 0; i < poly.length - 1; i++) {
      const aw = poly[i];
      const bw = poly[i + 1];
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
      cands.push({ aw, bw, ux, uy, perpDist, s, segLen, polylineIndex: pi });
    }
  }
  if (cands.length === 0) return { x, y, guides: [] };

  // Prefer candidates where the parallel projection lies inside the
  // segment (the bullet sits between the two stations); otherwise prefer
  // the segment whose nearest endpoint is closest to the bullet, so a
  // bullet placed past the end of the line latches onto the actual end
  // segment instead of an arbitrary first-iterator-wins parallel one.
  cands.sort((a, b) => {
    const aInside = a.s >= 0 && a.s <= a.segLen ? 0 : 1;
    const bInside = b.s >= 0 && b.s <= b.segLen ? 0 : 1;
    if (aInside !== bInside) return aInside - bInside;
    const aMin = Math.min(
      Math.hypot(x - a.aw.x, y - a.aw.y),
      Math.hypot(x - a.bw.x, y - a.bw.y),
    );
    const bMin = Math.min(
      Math.hypot(x - b.aw.x, y - b.aw.y),
      Math.hypot(x - b.bw.x, y - b.bw.y),
    );
    return aMin - bMin;
  });
  const best = cands[0];
  const sx = best.aw.x + best.s * best.ux;
  const sy = best.aw.y + best.s * best.uy;
  // Guide endpoints are the polyline's terminal stations, so labels show
  // distance to the actual neighboring stations even when the snapped
  // position sits along an interior segment of a curved polyline.
  const poly = polylines[best.polylineIndex];
  const startEndpoint = poly[0];
  const endEndpoint = poly[poly.length - 1];
  const dStart = Math.hypot(sx - startEndpoint.x, sy - startEndpoint.y);
  const dEnd = Math.hypot(sx - endEndpoint.x, sy - endEndpoint.y);
  const insideSegment = best.s >= 0 && best.s <= best.segLen;
  const guides: SnapGuide[] = [];
  if (insideSegment) {
    // Bullet projection sits between the two endpoints — both are
    // meaningful neighbors (one on each side along the line direction).
    guides.push({
      from: { x: sx, y: sy },
      to: startEndpoint,
      label: Math.round(dStart).toString(),
    });
    guides.push({
      from: { x: sx, y: sy },
      to: endEndpoint,
      label: Math.round(dEnd).toString(),
    });
  } else {
    // Bullet projection sits outside the segment — both endpoints lie on
    // the same side of the bullet along the line. Only the nearest one is
    // useful; a second guide just clutters.
    const useStart = dStart < dEnd;
    guides.push({
      from: { x: sx, y: sy },
      to: useStart ? startEndpoint : endEndpoint,
      label: Math.round(useStart ? dStart : dEnd).toString(),
    });
  }
  return { x: sx, y: sy, guides };
}
