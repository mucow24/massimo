// Geometry of a NON-SQUARE line end — the stop marker at a terminus with the
// 'short' or 'round' end style (see model/lineEnd.ts).
//
// Everything here is built in the OUTWARD frame: the unit vector `ow` pointing
// out of the line at that terminus (read from the band's own centerline tangent
// — see endOutwardFromBands), and its perpendicular. NOT the marker
// square's rotation frame: the square is squared to the STOP's travel axis,
// which a user can set independently of the corridor the band actually runs
// along. A rounded end has to continue the stripe's edges, so it must follow the
// band — the same reason the casing end cap and the dashed terminus stub are
// already built this way.
//
// Naming, in the outward frame with `p = perp(ow)`:
//
//        A' ─────────── A          A  = c + p·half   (front, +p side)
//        │      c      ⟩ tip       B  = c − p·half   (front, −p side)
//        B' ─────────── B          A' = A − ow·half  (back, +p side)
//                                  B' = B − ow·half  (back, −p side)
//
// 'short' ends flat on the A–B line (the stop center); 'round' replaces that
// edge with a half-disc of radius `half` bulging out through the tip. The
// inward half (A–A'–B'–B) is the same rectangle in both.

import type { LineEndStyle } from '../model/types';
import { perp, type Vec2 } from './vec';

// Chord tolerance for sampling the round end into a polygon ring, world units.
// Deliberately the same value the stripe bodies flatten at (lineRegions'
// FLATTEN_TOL), so a round end's region cover tracks its painted arc exactly as
// tightly as the corridors it joins.
const ROUND_FLATTEN_TOL = 0.01;

// Path coordinates match the router's precision. This is load-bearing: the
// marker's side edges have to land on the band stripe's edges to the same
// number of digits, or the two disagree by a sub-pixel sliver and the seam
// between them shimmers ("hash bleed").
const fmt = (n: number) => n.toFixed(6);
const pt = (p: Vec2) => `${fmt(p.x)} ${fmt(p.y)}`;

// The four named corners, in the outward frame.
function corners(c: Vec2, ow: Vec2, half: number) {
  const p = perp(ow);
  const A = { x: c.x + p.x * half, y: c.y + p.y * half };
  const B = { x: c.x - p.x * half, y: c.y - p.y * half };
  return {
    A,
    B,
    Aback: { x: A.x - ow.x * half, y: A.y - ow.y * half },
    Bback: { x: B.x - ow.x * half, y: B.y - ow.y * half },
  };
}

/**
 * The SWEEP FLAG for the outward half-disc, in SVG's y-down user space.
 *
 * The arc runs A → tip → B, i.e. from +p round through +ow to −p. Parametrized
 * as c + half·(cos t · p + sin t · ow) that is t: 0 → π, which traverses the
 * circle in the NEGATIVE angle direction of the y-down frame — the flag SVG
 * spells 0. A rotation of the whole configuration is orientation-preserving, so
 * this is a constant, not a per-direction computation.
 */
const ROUND_SWEEP = 0;

/**
 * Closed `M … Z` outline of a non-square terminus marker, for painting. The
 * caller fills it (flat color, or a hatch pattern — `userSpaceOnUse` patterns
 * align with a world-space path exactly as they do with the square's polygon).
 */
export function markerEndPath(c: Vec2, ow: Vec2, half: number, end: 'short' | 'round'): string {
  const { A, B, Aback, Bback } = corners(c, ow, half);
  const front =
    end === 'round' ? ` A ${fmt(half)} ${fmt(half)} 0 0 ${ROUND_SWEEP} ${pt(B)}` : ` L ${pt(B)}`;
  return `M ${pt(Aback)} L ${pt(A)}${front} L ${pt(Bback)} Z`;
}

/**
 * The same outline as a polygon ring for the region arrangement — the round
 * end's arc sampled by chord tolerance. Shares `corners` with the painted path,
 * so a cover can't drift from the paint it represents.
 *
 * WINDING IS LOAD-BEARING. The ring is emitted back → −p side → front → +p
 * side, which is the POSITIVE-area direction `rotatedRectCorners` (the square
 * end's ring) also produces. `unionAll` fills NonZero and does not normalize
 * orientation, so a ring wound the other way would cancel against the stripe
 * body it sits on and punch a hole in the line's own footprint.
 */
export function markerEndRing(c: Vec2, ow: Vec2, half: number, end: 'short' | 'round'): Vec2[] {
  const { A, B, Aback, Bback } = corners(c, ow, half);
  if (end === 'short') return [Aback, Bback, B, A];
  const p = perp(ow);
  // Chord error e = r(1 − cos(dt/2)) ⇒ dt = 2·acos(1 − e/r); clamped so a
  // hairline line width can't NaN the acos.
  const step = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - ROUND_FLATTEN_TOL / half)));
  const n = Math.min(256, Math.max(2, Math.ceil(Math.PI / Math.max(step, 1e-4))));
  const ring: Vec2[] = [Aback, Bback, B];
  // B → A across the front: t runs π → 0, the same sweep the painted arc takes.
  for (let i = n - 1; i >= 1; i--) {
    const t = (Math.PI * i) / n;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    ring.push({
      x: c.x + half * (cosT * p.x + sinT * ow.x),
      y: c.y + half * (cosT * p.y + sinT * ow.y),
    });
  }
  ring.push(A);
  return ring;
}

/**
 * The two casing rail segments of a non-square end: `[from, to]` pairs running
 * along the marker's side edges over the INWARD half only, so a rail can never
 * outlive the body it edges. Centered on the edge like every other rail (the
 * caller strokes them at the rail width) — which is also why the round end's
 * arc rail joins them smoothly: both sit on the shape's boundary.
 */
export function markerEndSides(c: Vec2, ow: Vec2, half: number): [Vec2, Vec2][] {
  const { A, B, Aback, Bback } = corners(c, ow, half);
  return [
    [Aback, A],
    [Bback, B],
  ];
}

/**
 * Open `M … A …` arc tracing a round end's outer boundary — the casing's end
 * cap for that style, replacing the straight bar a square or short end uses.
 * Stroked (not filled), centered on the same arc the body paints.
 */
export function markerEndRailArc(c: Vec2, ow: Vec2, half: number): string {
  const { A, B } = corners(c, ow, half);
  return `M ${pt(A)} A ${fmt(half)} ${fmt(half)} 0 0 ${ROUND_SWEEP} ${pt(B)}`;
}

/**
 * Where a terminus's straight casing end cap sits: at the marker's outer edge
 * for a square end, at the stop center for a short one (a round end uses
 * {@link markerEndRailArc} instead). The line ENDS there, so this is where the
 * casing closes around it.
 */
export function markerEndCapCenter(c: Vec2, ow: Vec2, half: number, end: LineEndStyle): Vec2 {
  return end === 'square' ? { x: c.x + ow.x * half, y: c.y + ow.y * half } : c;
}
