/**
 * Pure geometry for baking hatch `<pattern>` paints into primitive stripe
 * geometry in the PDF export (see exportCanvasPdf.ts). svg2pdf can't tile a
 * pattern along a stroke, so each hatched band/marker is re-expressed as a clip
 * region filled with solid diagonal stripes. These helpers carry the math;
 * exportCanvasPdf owns the DOM sampling and element building.
 */
import { leftNormal, norm, sub, type Vec2 } from '../geometry/vec';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Degrees of the `rotate(…)` in a patternTransform (the hatch angle), else 0. */
export function patternRotation(transform: string | null): number {
  const m = /rotate\(\s*(-?[\d.]+)/.exec(transform ?? '');
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Approximate the filled band region of a stroked centerline by offsetting each
 * sample ±width/2 along the local left-normal, returning a closed ribbon
 * polygon (forward along one edge, back along the other) plus its bounds. The
 * caller samples the live path into `centerline`; this stays pure so it works
 * for straight runs and fillets alike. Null for a degenerate input.
 */
export function ribbonFromCenterline(
  centerline: Vec2[],
  width: number,
): { points: string; bounds: Bounds } | null {
  if (centerline.length < 2 || !(width > 0)) return null;
  const half = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < centerline.length; i++) {
    // Local tangent from the neighbouring samples (forward/backward diff at the
    // ends); left-normal gives the perpendicular offset direction.
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    const n = leftNormal(norm(sub(next, prev)));
    const p = centerline[i];
    left.push({ x: p.x + n.x * half, y: p.y + n.y * half });
    right.push({ x: p.x - n.x * half, y: p.y - n.y * half });
  }
  const ring = [...left, ...right.reverse()];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of ring) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  const points = ring.map((q) => `${q.x},${q.y}`).join(' ');
  return { points, bounds: { minX, minY, maxX, maxY } };
}

/**
 * The phased stripe rects that, placed in a group rotated `angleDeg` about the
 * world origin and clipped to `bounds`, reproduce a `userSpaceOnUse` hatch.
 * Stripes are vertical in that rotated frame, `stripeWidth` wide, repeating
 * every `stripeWidth + gap`. Columns are phased from x = 0 (multiples of the
 * tile pitch), so two regions sharing the pattern — a band and the stop marker
 * on it — stay perfectly continuous instead of seaming.
 */
export function hatchStripeRects(
  bounds: Bounds,
  angleDeg: number,
  stripeWidth: number,
  gap: number,
): Rect[] {
  const tile = stripeWidth + gap;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { minX, minY, maxX, maxY } = bounds;
  // Project the bbox corners into the rotated frame (inverse rotation) to find
  // which tile columns (x') and the vertical span (y') the stripes must cover.
  let xpMin = Infinity;
  let xpMax = -Infinity;
  let ypMin = Infinity;
  let ypMax = -Infinity;
  for (const [X, Y] of [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ] as const) {
    const xp = X * cos + Y * sin;
    const yp = -X * sin + Y * cos;
    if (xp < xpMin) xpMin = xp;
    if (xp > xpMax) xpMax = xp;
    if (yp < ypMin) ypMin = yp;
    if (yp > ypMax) ypMax = yp;
  }
  const rects: Rect[] = [];
  for (let k = Math.floor(xpMin / tile); k <= Math.ceil(xpMax / tile); k++) {
    rects.push({
      x: k * tile,
      y: ypMin - tile,
      width: stripeWidth,
      height: ypMax - ypMin + tile * 2,
    });
  }
  return rects;
}
