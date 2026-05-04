import { Vec2, add, sub, scale, dot, perp, len, norm } from './vec';

const TAU = Math.PI * 2;
const SQRT2_2 = Math.SQRT2 / 2;

export const DIRS_8: Vec2[] = [
  { x: 1, y: 0 }, // 0: E
  { x: SQRT2_2, y: SQRT2_2 }, // 1: SE (screen, y-down)
  { x: 0, y: 1 }, // 2: S
  { x: -SQRT2_2, y: SQRT2_2 }, // 3: SW
  { x: -1, y: 0 }, // 4: W
  { x: -SQRT2_2, y: -SQRT2_2 }, // 5: NW
  { x: 0, y: -1 }, // 6: N
  { x: SQRT2_2, y: -SQRT2_2 }, // 7: NE
];

export const dirIndex = (d: Vec2): number => {
  let a = Math.atan2(d.y, d.x);
  if (a < 0) a += TAU;
  return Math.round(a / (Math.PI / 4)) % 8;
};

export const bendAngle = (i1: number, i2: number): number => {
  let diff = (((i2 - i1) % 8) + 8) % 8;
  if (diff > 4) diff = 8 - diff;
  return diff * (Math.PI / 4);
};

const tanLen = (R: number, theta: number) => R * Math.tan(theta / 2);

export interface RouteResult {
  vertices: Vec2[]; // polyline corners (including start, end)
  pathD: string; // SVG path with arc fillets at interior vertices
  warning: boolean; // true if router couldn't satisfy constraints cleanly
}

const EPS = 1e-6;

export function route(
  start: Vec2,
  startDir: Vec2,
  end: Vec2,
  endDir: Vec2,
  R: number,
  waypoints?: Vec2[],
): RouteResult {
  const sIdx = dirIndex(startDir);
  const eIdx = dirIndex(endDir);
  const sDir = DIRS_8[sIdx];
  const eDir = DIRS_8[eIdx];

  if (waypoints && waypoints.length > 0) {
    // Stitch path through forced waypoints by routing each leg.
    const verts: Vec2[] = [start];
    let cursor = start;
    let cursorDir = sDir;
    let warning = false;
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const nextDir = norm(sub(i + 1 < waypoints.length ? waypoints[i + 1] : end, wp));
      const nextDirIdx = dirIndex(nextDir);
      const sub1 = routeLeg(cursor, cursorDir, wp, DIRS_8[nextDirIdx], R);
      verts.push(...sub1.vertices.slice(1));
      cursor = wp;
      cursorDir = DIRS_8[nextDirIdx];
      if (sub1.warning) warning = true;
    }
    const last = routeLeg(cursor, cursorDir, end, eDir, R);
    verts.push(...last.vertices.slice(1));
    if (last.warning) warning = true;
    return { vertices: verts, pathD: filletPath(verts, R), warning };
  }

  return routeLeg(start, sDir, end, eDir, R);
}

function routeLeg(start: Vec2, sDir: Vec2, end: Vec2, eDir: Vec2, R: number): RouteResult {
  const sIdx = dirIndex(sDir);
  const eIdx = dirIndex(eDir);
  const Δ = sub(end, start);

  type Cand = { vertices: Vec2[]; bends: number; length: number };
  const cands: Cand[] = [];

  // 0-bend
  if (sIdx === eIdx) {
    const along = dot(Δ, sDir);
    const perpAmt = Math.abs(dot(Δ, perp(sDir)));
    if (along > EPS && perpAmt < 1e-3) {
      cands.push({ vertices: [start, end], bends: 0, length: along });
    }
  }

  // 1-bend
  if (sIdx !== eIdx && Math.abs(sIdx - eIdx) % 8 !== 0) {
    const v = solveOneBend(start, sDir, end, eDir, R);
    if (v) {
      const verts = [start, v, end];
      cands.push({ vertices: verts, bends: 1, length: polyLen(verts) });
    }
  }

  // 2-bend
  for (let mIdx = 0; mIdx < 8; mIdx++) {
    if (mIdx === sIdx || mIdx === eIdx) continue;
    const mDir = DIRS_8[mIdx];
    const θ1 = bendAngle(sIdx, mIdx);
    const θ2 = bendAngle(mIdx, eIdx);
    if (θ1 < EPS || θ2 < EPS) continue;
    if (θ1 > Math.PI - EPS || θ2 > Math.PI - EPS) continue;
    const tw = solveTwoBend(start, sDir, mDir, end, eDir, R, θ1, θ2);
    if (tw) {
      const verts = [start, tw.v1, tw.v2, end];
      cands.push({ vertices: verts, bends: 2, length: polyLen(verts) });
    }
  }

  // 3-bend U-turn fallback (mostly for d_s == -d_e cases).
  if (cands.length === 0) {
    const u = solveUTurn(start, sDir, end, eDir, R);
    if (u) {
      cands.push({ vertices: u, bends: 3, length: polyLen(u) });
    }
  }

  if (cands.length === 0) {
    // Last resort: emit a straight line and warn loudly.
    return { vertices: [start, end], pathD: `M ${fmt(start)} L ${fmt(end)}`, warning: true };
  }

  // Pick min length, with bend-count as tiebreaker (fewer bends preferred when length close).
  cands.sort((a, b) => {
    if (Math.abs(a.length - b.length) > 0.5) return a.length - b.length;
    return a.bends - b.bends;
  });

  const best = cands[0];
  // A route is "tight" if it forces sharp turns or arcs that have to shrink
  // far below the configured radius. Tight routes produce ugly geometry —
  // especially in interlined bands, where offset paths can't fit neatly and
  // sometimes blow up near degenerate bends. When we detect tightness, drop
  // back to a dumb straight-line fallback for both the centerline and any
  // offset paths derived from it, and flag the warning so the user sees a
  // toast and can fix the layout.
  let warning = false;
  for (let i = 1; i < best.vertices.length - 1 && !warning; i++) {
    const inDir = norm(sub(best.vertices[i], best.vertices[i - 1]));
    const outDir = norm(sub(best.vertices[i + 1], best.vertices[i]));
    const cosA = Math.max(-1, Math.min(1, dot(inDir, outDir)));
    const θ = Math.acos(cosA);
    if (θ > (3 * Math.PI) / 4 - 0.01) warning = true; // ≥ 135°
  }
  if (!warning) {
    const { rs } = computeArcRadii(best.vertices, R);
    for (const r of rs) {
      if (r > 0 && r < R * 0.5) {
        warning = true;
        break;
      }
    }
  }
  if (warning) {
    return {
      vertices: [start, end],
      pathD: `M ${fmt(start)} L ${fmt(end)}`,
      warning: true,
    };
  }
  return {
    vertices: best.vertices,
    pathD: filletPath(best.vertices, R),
    warning: false,
  };
}

function polyLen(verts: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < verts.length; i++) s += len(sub(verts[i], verts[i - 1]));
  return s;
}

function solveOneBend(start: Vec2, sDir: Vec2, end: Vec2, eDir: Vec2, R: number): Vec2 | null {
  const Δ = sub(end, start);
  const det = sDir.x * eDir.y - eDir.x * sDir.y;
  if (Math.abs(det) < EPS) return null;
  const tS = (Δ.x * eDir.y - Δ.y * eDir.x) / det;
  const tE = (sDir.x * Δ.y - Δ.x * sDir.y) / det;
  if (tS <= 0 || tE <= 0) return null;
  const θ = Math.acos(Math.max(-1, Math.min(1, dot(sDir, eDir))));
  const need = tanLen(R, θ);
  if (tS < need - EPS || tE < need - EPS) return null;
  return add(start, scale(sDir, tS));
}

function solveTwoBend(
  start: Vec2,
  sDir: Vec2,
  mDir: Vec2,
  end: Vec2,
  eDir: Vec2,
  R: number,
  θ1: number,
  θ2: number,
): { v1: Vec2; v2: Vec2 } | null {
  const tan1 = tanLen(R, θ1);
  const tan2 = tanLen(R, θ2);
  const Δ = sub(end, start);
  const minMid = tan1 + tan2;

  const cross_se = sDir.x * eDir.y - eDir.x * sDir.y;

  if (Math.abs(cross_se) < EPS) {
    // d_s parallel to d_e (same or opposite). Z-shape or U-shape.
    const perpS = perp(sDir);
    const dmPerp = dot(mDir, perpS);
    if (Math.abs(dmPerp) < EPS) return null; // m parallel to s
    const ΔPerp = dot(Δ, perpS);
    const tM = ΔPerp / dmPerp;
    if (tM <= 0 || tM < minMid - EPS) return null;
    const Δalong = dot(Δ, sDir);
    const sameDir = dot(sDir, eDir) > 0;
    if (!sameDir) return null; // anti-parallel handled elsewhere
    const remainAlong = Δalong - tM * dot(mDir, sDir);
    if (remainAlong <= 0) return null;
    let tS = remainAlong / 2;
    let tE = remainAlong / 2;
    if (tS < tan1) {
      tS = tan1;
      tE = remainAlong - tS;
    }
    if (tE < tan2) {
      tE = tan2;
      tS = remainAlong - tE;
    }
    if (tS < tan1 - EPS || tE < tan2 - EPS) return null;
    const v1 = add(start, scale(sDir, tS));
    const v2 = add(v1, scale(mDir, tM));
    return { v1, v2 };
  }

  // Non-parallel d_s, d_e. Search over t_m starting at minMid.
  for (let step = 0; step <= 16; step++) {
    const tM = minMid + step * R * 0.5;
    const Δp = sub(Δ, scale(mDir, tM));
    const tS = (Δp.x * eDir.y - Δp.y * eDir.x) / cross_se;
    const tE = (sDir.x * Δp.y - Δp.x * sDir.y) / cross_se;
    if (tS >= tan1 - EPS && tE >= tan2 - EPS) {
      const v1 = add(start, scale(sDir, tS));
      const v2 = add(v1, scale(mDir, tM));
      return { v1, v2 };
    }
  }
  return null;
}

function solveUTurn(start: Vec2, sDir: Vec2, end: Vec2, eDir: Vec2, R: number): Vec2[] | null {
  // 3-bend rectangular detour: sDir → perp → -sDir-ish → eDir.
  // Most useful when d_s == -d_e.
  const Δ = sub(end, start);
  const tanR = tanLen(R, Math.PI / 2);
  for (const sgn of [1, -1]) {
    const pSide = scale(perp(sDir), sgn);
    // Use shape: a*sDir, b*pSide, c*(-sDir), d*eDir (4 segments, 3 bends).
    // a*sDir + b*pSide + c*(-sDir) + d*eDir = Δ
    // (a - c)*sDir + b*pSide + d*eDir = Δ
    // Decompose Δ in (sDir, pSide) basis:
    const along = dot(Δ, sDir);
    const side = dot(Δ, pSide);
    // d*eDir contributes dot(eDir, sDir) along sDir, dot(eDir, pSide) along pSide.
    const eAlong = dot(eDir, sDir);
    const eSide = dot(eDir, pSide);
    // Pick d = some safe value, then solve:
    // (a - c) + d * eAlong = along
    // b + d * eSide = side
    // For each d, b is determined: b = side - d*eSide. Need b >= 2*tanR (to fit 90° fillets at both ends).
    // (a - c) = along - d*eAlong. We split a, c such that both >= tanR.
    for (const dGuess of [tanR * 2, tanR * 4, tanR * 8, R * 6]) {
      const d = dGuess;
      const b = side - d * eSide;
      if (b < 2 * tanR - EPS) continue;
      const ac = along - d * eAlong;
      // Pick a + c = max(2*tanR, |ac| + 2*tanR) to keep both above tanR.
      const minSum = Math.max(2 * tanR, Math.abs(ac) + 2 * tanR);
      const a = (minSum + ac) / 2;
      const c = (minSum - ac) / 2;
      if (a < tanR - EPS || c < tanR - EPS) continue;
      const V1 = add(start, scale(sDir, a));
      const V2 = add(V1, scale(pSide, b));
      const V3 = add(V2, scale(sDir, -c));
      // Sanity: V3 + d*eDir should ≈ end
      const reconstructed = add(V3, scale(eDir, d));
      if (len(sub(reconstructed, end)) > 1e-2) continue;
      return [start, V1, V2, V3, end];
    }
  }
  return null;
}

const fmt = (p: Vec2) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

/**
 * For a polyline, compute the effective arc radius and bend angle at each
 * interior corner. Tangents are scaled down where they collide on a shared
 * edge: for each edge, t_a + t_b ≤ edge_length. Both adjacent corners are
 * scaled by the same factor when over-constrained, so radii at neighboring
 * corners stay proportional. Used by `filletPath` and `offsetFilletPath` so
 * that all paths in an interlined band share concentric arc centers.
 */
function computeArcRadii(verts: Vec2[], R: number): { rs: number[]; angles: number[] } {
  const n = verts.length;
  const rs = new Array(n).fill(R);
  const angles = new Array(n).fill(0);
  const tans = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const inDir = norm(sub(verts[i], verts[i - 1]));
    const outDir = norm(sub(verts[i + 1], verts[i]));
    const cosA = Math.max(-1, Math.min(1, dot(inDir, outDir)));
    angles[i] = Math.acos(cosA);
    tans[i] = R * Math.tan(angles[i] / 2);
  }
  for (let i = 0; i < n - 1; i++) {
    const edgeLen = len(sub(verts[i + 1], verts[i]));
    const sum = tans[i] + tans[i + 1];
    if (sum > edgeLen - EPS && sum > EPS) {
      const factor = (edgeLen - EPS) / sum;
      tans[i] *= factor;
      tans[i + 1] *= factor;
    }
  }
  for (let i = 1; i < n - 1; i++) {
    if (angles[i] > EPS) rs[i] = tans[i] / Math.tan(angles[i] / 2);
    else rs[i] = 0;
  }
  return { rs, angles };
}

/**
 * Build an SVG path string from a polyline, replacing each interior vertex
 * with a circular-arc fillet tangent to both adjacent edges. Radius is taken
 * from `computeArcRadii`, which honors per-edge tangent budget so an arc that
 * needs more than half its edge can take it as long as the neighbor doesn't.
 */
export function filletPath(verts: Vec2[], R: number): string {
  if (verts.length < 2) return '';
  if (verts.length === 2) return `M ${fmt(verts[0])} L ${fmt(verts[1])}`;
  const { rs, angles } = computeArcRadii(verts, R);

  let d = `M ${fmt(verts[0])}`;
  for (let i = 1; i < verts.length - 1; i++) {
    const r = rs[i];
    const θ = angles[i];
    if (θ < EPS || r < EPS) {
      d += ` L ${fmt(verts[i])}`;
      continue;
    }
    const inDir = norm(sub(verts[i], verts[i - 1]));
    const outDir = norm(sub(verts[i + 1], verts[i]));
    const useTan = r * Math.tan(θ / 2);
    const pIn = sub(verts[i], scale(inDir, useTan));
    const pOut = add(verts[i], scale(outDir, useTan));
    const cz = inDir.x * outDir.y - inDir.y * outDir.x;
    const sweep = cz > 0 ? 1 : 0;
    d += ` L ${fmt(pIn)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${sweep} ${fmt(pOut)}`;
  }
  d += ` L ${fmt(verts[verts.length - 1])}`;
  return d;
}

/**
 * Like filletPath but emits a translated path offset perpendicular to the
 * local direction by `offset` (constant signed distance). Used for interlining
 * bands that share a centerline.
 */
export function offsetFilletPath(verts: Vec2[], R: number, offset: number): string {
  if (Math.abs(offset) < EPS) return filletPath(verts, R);
  if (verts.length < 2) return '';

  // Offset every vertex perpendicular to its incident edges. Convention: a
  // positive offset moves each point 90° counter-clockwise (visually, in y-down
  // screen) from the direction of motion — i.e., toward the traveler's left.
  // This matches the "stop k=0 is screen-left when traveling south at rot 0"
  // convention used everywhere else.
  const leftOf = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });
  const offV: Vec2[] = verts.map((p, i) => {
    let n: Vec2;
    if (i === 0) n = leftOf(norm(sub(verts[1], verts[0])));
    else if (i === verts.length - 1) n = leftOf(norm(sub(verts[i], verts[i - 1])));
    else {
      const a = leftOf(norm(sub(verts[i], verts[i - 1])));
      const b = leftOf(norm(sub(verts[i + 1], verts[i])));
      const sum = { x: a.x + b.x, y: a.y + b.y };
      const ln = Math.hypot(sum.x, sum.y);
      n = ln < EPS ? a : { x: sum.x / ln, y: sum.y / ln };
      // Distance from V to the offset corner along the bisector is
      // |offset| / cos(half-angle). For bends approaching 180° cos(half)
      // approaches 0 and the offset corner flies off to infinity, leaving
      // a long spike in the rendered band. Cap the scale at a reasonable
      // limit so near-degenerate bends just look like sharp corners
      // instead of geometric explosions.
      const MAX_BISECTOR_SCALE = 3;
      const cosHalf = Math.max(1 / MAX_BISECTOR_SCALE, dot(n, a));
      n = { x: n.x / cosHalf, y: n.y / cosHalf };
    }
    return { x: p.x + n.x * offset, y: p.y + n.y * offset };
  });

  if (offV.length === 2) return `M ${fmt(offV[0])} L ${fmt(offV[1])}`;

  // Use the centerline's effective per-corner radii so offset arcs share
  // arc centers with the centerline. Concentric → no gaps between bands.
  const { rs, angles } = computeArcRadii(verts, R);

  let d = `M ${fmt(offV[0])}`;
  for (let i = 1; i < offV.length - 1; i++) {
    const θ = angles[i];
    if (θ < EPS) {
      d += ` L ${fmt(offV[i])}`;
      continue;
    }
    // Sweep direction is determined from the centerline (parallel offset
    // doesn't change which side the bend curves toward).
    const inOrig = norm(sub(verts[i], verts[i - 1]));
    const outOrig = norm(sub(verts[i + 1], verts[i]));
    const cz = inOrig.x * outOrig.y - inOrig.y * outOrig.x;
    const sweep = cz > 0 ? 1 : 0;

    // r' = centerline rs[i] ± offset, with sign by inside/outside at this corner.
    const onInside = (cz > 0 && offset < 0) || (cz < 0 && offset > 0);
    const r = rs[i] + (onInside ? -Math.abs(offset) : Math.abs(offset));
    if (r < EPS) {
      d += ` L ${fmt(offV[i])}`;
      continue;
    }
    const useTan = r * Math.tan(θ / 2);

    // Use the centerline directions — they're parallel to the offset edges,
    // and using offV's directly would divide-by-near-zero whenever the
    // bisector cap pulls two offset corners together.
    const inDir = norm(sub(verts[i], verts[i - 1]));
    const outDir = norm(sub(verts[i + 1], verts[i]));
    const pIn = sub(offV[i], scale(inDir, useTan));
    const pOut = add(offV[i], scale(outDir, useTan));
    d += ` L ${fmt(pIn)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${sweep} ${fmt(pOut)}`;
  }
  d += ` L ${fmt(offV[offV.length - 1])}`;
  return d;
}
