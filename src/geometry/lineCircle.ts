import type { Vec2 } from './vec';

// Pure line-circle math, shared by the binding transforms, the drag
// constraint, and the arc-edge renderer. A circle is taken structurally
// ({x, y, radius}) so both the LineCircle entity and scratch specs fit.
export interface CircleSpec {
  x: number;
  y: number;
  radius: number;
}

/**
 * The line circle a station is bound to, or null when it is free (or its
 * `circleId` dangles). The single lookup every frame-resolving caller goes
 * through — a station's cell frame depends on it (see `stationFrameRad`), so
 * "is this station on a ring" must read the same way everywhere.
 */
export function stationCircle<C extends CircleSpec>(
  station: { circleId?: string },
  lineCircles: Record<string, C>,
): C | null {
  return station.circleId !== undefined ? (lineCircles[station.circleId] ?? null) : null;
}

/**
 * Polar angle of `p` as seen from the circle's center, in radians. Screen
 * y-down frame: angle 0 is EAST of center, increasing angles sweep
 * east → south → west → north (visually clockwise). A point AT the center has
 * no direction; it reads as angle 0, so the degenerate projection lands on
 * the circle's east point rather than exploding.
 */
export function circleAngleAt(c: CircleSpec, p: Vec2): number {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

/** The circumference point at polar angle `theta` (see circleAngleAt). */
export function pointAtAngle(c: CircleSpec, theta: number): Vec2 {
  return { x: c.x + c.radius * Math.cos(theta), y: c.y + c.radius * Math.sin(theta) };
}

/** Nearest point on the circle's circumference to `p` (center ⇒ angle 0). */
export function projectToCircle(c: CircleSpec, p: Vec2): Vec2 {
  return pointAtAngle(c, circleAngleAt(c, p));
}

/**
 * Angular spacing of a circle's CARDINAL points — the eight marks at 45° from
 * due east (E, SE, S, SW, W, NW, N, NE in the y-down frame).
 */
export const CIRCLE_CARDINAL_STEP = Math.PI / 4;

/**
 * Those eight angles, E → SE → S → … → NE (clockwise in the y-down frame).
 * One owner, so the toolbar glyph, the on-canvas ticks and the snap can't
 * disagree about where a cardinal is or how many there are.
 */
export const CIRCLE_CARDINAL_ANGLES: readonly number[] = Array.from(
  { length: Math.round((2 * Math.PI) / CIRCLE_CARDINAL_STEP) },
  (_, k) => k * CIRCLE_CARDINAL_STEP,
);

/**
 * Where a station seats on `c` when aimed at `p`: the radial projection of
 * {@link projectToCircle}, pulled onto the nearest CARDINAL point when
 * `cardinalTolerance` is non-null and the projection lands within that much
 * ARC of one. Pass `null` to seat on the rim only.
 *
 * The tolerance is an arc LENGTH in world units, not an angle, so the magnetic
 * window spans a constant number of screen px at any radius and zoom — the
 * same feel as every other snap (callers pass `snapToleranceAt(zoom)`). It
 * follows that a tight ring is strongly cardinal and a huge one barely is,
 * which is the useful direction: cardinals matter most where the ring is too
 * small to eyeball a quarter turn.
 *
 * One owner of "which ANGLE on the ring does this cursor mean", shared by the
 * station drag, station placement and the Edit Stops create-click so they can
 * never disagree — the same reason `lineCircleAtPoint` owns the capture test.
 * The resulting POSE (position plus tangent rotation) is still `circleSeat`'s
 * in the model layer, which reprojects whatever point it is handed; these two
 * compose, and the composition is only sound because this function is
 * idempotent on a point already on the rim.
 */
export function snapPointToCircle(c: CircleSpec, p: Vec2, cardinalTolerance: number | null): Vec2 {
  const theta = circleAngleAt(c, p);
  // A degenerate radius has no arc to measure a tolerance against, so there is
  // nothing to quantize toward — seat radially and let the caller's rim
  // capture decide whether that point was reachable at all.
  if (cardinalTolerance === null || !(c.radius > 0)) return pointAtAngle(c, theta);
  const nearest = Math.round(theta / CIRCLE_CARDINAL_STEP) * CIRCLE_CARDINAL_STEP;
  // |nearest − theta| ≤ half a step by construction, so this never wraps and
  // needs no `wrapAngleToPi`. (θ near ±π rounds to ∓π's twin, the same point.)
  const arc = Math.abs(nearest - theta) * c.radius;
  return pointAtAngle(c, arc <= cardinalTolerance ? nearest : theta);
}

/**
 * Unit tangent of the circle at polar angle `theta` — the direction of travel
 * for increasing theta (visually clockwise in the y-down frame). Its sign is
 * immaterial to station orientation (a travel axis is symmetric under 180°);
 * the label-uprightness flip picks the readable one.
 */
export function tangentAtAngle(theta: number): Vec2 {
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}

/**
 * The line circle whose RIM lies NEAREST `p`, within `tolerance`, or null —
 * nearest, not first found, so overlapping rings capture the one actually under
 * the cursor (ties go to the last in key order). The capture test for binding
 * gestures: station drags, station placement and the Edit Stops create-click all
 * share it, so "close enough to snap onto the ring" can never mean different
 * things in different modes.
 */
export function lineCircleAtPoint<C extends CircleSpec & { id: string }>(
  lineCircles: Record<string, C>,
  p: Vec2,
  tolerance: number,
): C | null {
  let best: C | null = null;
  let bestDist = tolerance;
  for (const id of Object.keys(lineCircles)) {
    const c = lineCircles[id];
    const d = Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.radius);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * The JOINT WEDGE at a stop where two band frames meet (a ring stop with an
 * arc on one side and an octolinear band on the other). Both bands end AT the
 * stop center with butt caps perpendicular to their own travel axes, so the
 * uncovered ink is exactly the bowtie between the two cap lines, clipped to
 * the stripe width: corners at c ± perpA·(w/2) and c ± perpB·(w/2) — all ON
 * the stripes' edges, so the filler pokes nothing past the band silhouette
 * (a full second square would overshoot by up to w/√2 − w/2 at its corners).
 *
 * Returns the four corners ordered as the crossed "bowtie" quad
 * [pA+, pB+, pA−, pB−] — one lobe per side, both filled under either SVG fill
 * rule — or null when the frames are (nearly) parallel and there is no wedge.
 * `aDeg`/`bDeg` are travel-AXIS angles in degrees; sign is immaterial (the
 * perpendiculars are sign-aligned before pairing).
 */
export function jointWedgeCorners(
  c: Vec2,
  aDeg: number,
  bDeg: number,
  width: number,
): [Vec2, Vec2, Vec2, Vec2] | null {
  const aRad = (aDeg * Math.PI) / 180;
  const bRad = (bDeg * Math.PI) / 180;
  const perpA = { x: -Math.sin(aRad), y: Math.cos(aRad) };
  let perpB = { x: -Math.sin(bRad), y: Math.cos(bRad) };
  if (perpA.x * perpB.x + perpA.y * perpB.y < 0) perpB = { x: -perpB.x, y: -perpB.y };
  // Parallel frames (axis difference ~0 mod 180°): no wedge to fill.
  if (Math.abs(perpA.x * perpB.y - perpA.y * perpB.x) < 1e-6) return null;
  const h = width / 2;
  return [
    { x: c.x + perpA.x * h, y: c.y + perpA.y * h },
    { x: c.x + perpB.x * h, y: c.y + perpB.y * h },
    { x: c.x - perpA.x * h, y: c.y - perpA.y * h },
    { x: c.x - perpB.x * h, y: c.y - perpB.y * h },
  ];
}

/**
 * One HALF of a joint stop's marker: a width × width/2 rectangle extending
 * from the stop's cap plane in `dir` (unit), full stripe width across. The
 * arc-side half takes the tangent frame's `jointArcOut`; the straight-side
 * half takes the octant frame via {@link jointStraightOut}. Shared by the
 * painter and the region footprint so the cover is the paint.
 */
export function jointHalfSquareCorners(
  c: Vec2,
  dir: Vec2,
  width: number,
): [Vec2, Vec2, Vec2, Vec2] {
  const h = width / 2;
  const n = { x: -dir.y, y: dir.x };
  return [
    { x: c.x + n.x * h, y: c.y + n.y * h },
    { x: c.x + n.x * h + dir.x * h, y: c.y + n.y * h + dir.y * h },
    { x: c.x - n.x * h + dir.x * h, y: c.y - n.y * h + dir.y * h },
    { x: c.x - n.x * h, y: c.y - n.y * h },
  ];
}

/**
 * The straight-side direction of a joint marker: the octant travel axis
 * (`jointRotationDeg`), sign-picked to point AWAY from the arc side.
 */
export function jointStraightOut(jointRotationDeg: number, jointArcOut: Vec2): Vec2 {
  const rad = (jointRotationDeg * Math.PI) / 180;
  const o = { x: Math.cos(rad), y: Math.sin(rad) };
  return o.x * jointArcOut.x + o.y * jointArcOut.y <= 0 ? o : { x: -o.x, y: -o.y };
}

/** The joint-marker fields of a `StopMarkerSpec`, taken structurally. */
export interface JointMarkerSpec {
  cx: number;
  cy: number;
  width: number;
  rotationDeg: number;
  jointRotationDeg: number | null;
  jointArcOut: Vec2 | null;
}

/**
 * The three pieces a JOINT stop is made of — arc-side half-square, straight-side
 * half-square, and the cap-plane wedge between them — or null when `spec` is not
 * a joint stop at all. `wedge` is null on its own when the two frames are
 * (nearly) parallel and there is nothing between them.
 *
 * One owner for the decomposition, because the painter and the region cover BOTH
 * need it and must agree exactly: the region footprint is what masks the paint,
 * so a piece present in one and absent from the other shows up as a sliver of
 * the wrong line's color at the joint. (They still differ downstream, and
 * legitimately: the painter draws `wedge` as one crossed "bowtie" polygon, while
 * the clipper wants its two SIMPLE triangle lobes.)
 */
export function jointMarkerPieces(spec: JointMarkerSpec): {
  arcHalf: [Vec2, Vec2, Vec2, Vec2];
  straightHalf: [Vec2, Vec2, Vec2, Vec2];
  wedge: [Vec2, Vec2, Vec2, Vec2] | null;
} | null {
  const { jointRotationDeg, jointArcOut } = spec;
  if (jointRotationDeg === null || jointArcOut === null) return null;
  const center = { x: spec.cx, y: spec.cy };
  return {
    arcHalf: jointHalfSquareCorners(center, jointArcOut, spec.width),
    straightHalf: jointHalfSquareCorners(
      center,
      jointStraightOut(jointRotationDeg, jointArcOut),
      spec.width,
    ),
    wedge: jointWedgeCorners(center, spec.rotationDeg, jointRotationDeg, spec.width),
  };
}

/**
 * Line circles swept up by a marquee rect: hit iff the rect touches the RIM
 * (nearest point of the rect to the center is inside the radius, farthest
 * corner outside) — a marquee dragged wholly inside the ring grabs nothing,
 * matching how the rim is also the only click surface. Locked circles are
 * skipped unless `includeLocked` (the Alt-marquee recovery path, same as
 * every other kind).
 */
export function lineCirclesForRect(
  lineCircles: Record<string, CircleSpec & { id: string; locked?: boolean }>,
  rect: { x0: number; y0: number; x1: number; y1: number },
  includeLocked: boolean,
): string[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const out: string[] = [];
  for (const id of Object.keys(lineCircles)) {
    const c = lineCircles[id];
    if (c.locked && !includeLocked) continue;
    const nearest = Math.hypot(
      c.x - Math.max(minX, Math.min(maxX, c.x)),
      c.y - Math.max(minY, Math.min(maxY, c.y)),
    );
    if (nearest > c.radius) continue;
    const farthest = Math.max(
      Math.hypot(c.x - minX, c.y - minY),
      Math.hypot(c.x - maxX, c.y - minY),
      Math.hypot(c.x - minX, c.y - maxY),
      Math.hypot(c.x - maxX, c.y - maxY),
    );
    if (farthest >= c.radius) out.push(id);
  }
  return out;
}

/**
 * Normalize an angle difference into (−π, π] — the SHORTER way around, with
 * the antipodal tie broken deterministically toward +π (increasing theta =
 * visually clockwise in the y-down frame). This is the whole "which arc?"
 * rule: an edge between two circle stops always takes `wrapAngleToPi(a1 − a0)`
 * of sweep; anything longer is expressed by splicing a bound waypoint onto the
 * circle, which splits the edge into two shorter arcs.
 */
export function wrapAngleToPi(d: number): number {
  const TAU = 2 * Math.PI;
  let out = d % TAU;
  if (out > Math.PI) out -= TAU;
  else if (out <= -Math.PI) out += TAU;
  return out;
}

/**
 * The tangent polygon of a circular arc: a polyline that the router's fillet
 * machinery (`filletPath` / `emitOffsetSegments` at radius `c.radius`) renders
 * as EXACTLY that arc. Endpoints sit ON the circle at `a0` and `a0 + delta`;
 * each interior vertex is the intersection of the tangent lines at its piece's
 * boundary angles, so the per-corner tangent budget consumes the whole edge
 * and the fillet IS the arc (to within the router's 1e-6 tangent epsilon).
 *
 * This is what lets a line-circle band be an ordinary SegmentBandSpec — same
 * centerline/radius/offsets contract, no new fields, every consumer (paint,
 * outlines, tag/hit sampling, region flattening, the incremental-region hash)
 * reproduces the arc through the code paths it already has.
 *
 * `delta` is the signed sweep in (−π, π] (see wrapAngleToPi); the arc is split
 * into ≤ 90° pieces so tangent intersections stay bounded (miter scale ≤ √2,
 * well under the router's 3× cap, keeping offset stripes exactly concentric).
 */
export function arcTangentPolygon(c: CircleSpec, a0: number, delta: number): Vec2[] {
  const abs = Math.abs(delta);
  const A = pointAtAngle(c, a0);
  const B = pointAtAngle(c, a0 + delta);
  if (abs < 1e-7) return [A, B];
  const pieces = Math.max(1, Math.ceil(abs / (Math.PI / 2)));
  const step = delta / pieces;
  // One interior vertex per piece: the tangent lines at the piece's boundary
  // angles meet at the mid-angle, r / cos(step/2) from the center.
  const miter = c.radius / Math.cos(step / 2);
  const verts: Vec2[] = [A];
  for (let i = 0; i < pieces; i++) {
    const mid = a0 + (i + 0.5) * step;
    verts.push({ x: c.x + miter * Math.cos(mid), y: c.y + miter * Math.sin(mid) });
  }
  verts.push(B);
  return verts;
}
