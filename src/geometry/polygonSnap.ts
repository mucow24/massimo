import type { Vec2 } from './vec';
import { add, scale, sub, dot, cross } from './vec';
import {
  axesForAllSnap,
  axisFamily,
  constrainedGridMode,
  formatMeasurement,
  GRID_INTERVAL,
  guideAdmitsFoot,
  guideAxis,
  guideFoot,
  guideOffsetOf,
  guidePerpDist,
  projectOntoAxis,
  reconcileCorner,
  reconcileLockWithGrid,
  snapPointToGrid,
  solveTwoAxisLock,
  SNAP_PERP_TOLERANCE,
  type GridSnap,
  type GuideTarget,
  type SnapConstraint,
  type SnapGuide,
  type SnapModes,
} from './snap';

export interface PolygonSnapInput {
  /** The point being dragged — a vertex, or a whole-polygon's snap anchor. */
  proposed: Vec2;
  /**
   * A rigid SET of snappable points (a text label's four alignment-box
   * corners) dragged as one translation. When present, alignment candidates
   * come from exactly these points — include `proposed` in the list if it
   * should still generate candidates. Every engagement converts to the
   * translation that aligns its anchor; `proposed` stays the grid subject
   * (grid keeps the primary on the lattice, exactly as without anchors) and
   * the returned x/y stay in the primary's frame. Absent = [proposed].
   */
  anchors?: Vec2[];
  /** Targets for "Snap to line": the current polygon's other vertices. Aligned
   *  along all four axis families (horizontal, vertical, both diagonals). */
  lineTargets: Vec2[];
  /** Targets for "Snap to all": every station stop-center + every polygon
   *  vertex (assembled by the caller). Aligned along `axesForAllSnap(modes.all)`. */
  allTargets: Vec2[];
  modes: SnapModes;
  /** Perpendicular tolerance in world units. Defaults to {@link SNAP_PERP_TOLERANCE}. */
  tolerance?: number;
  /** Grid cell size in world units. Defaults to {@link GRID_INTERVAL} (10); the
   *  toolbar threads the active size (5, 10, or 20). */
  gridInterval?: number;
  /** Single-DOF consumers: only snaps that move the caller's one degree of
   *  freedom are considered. 'x'/'y' (edge resizes, straight-guide drags)
   *  keep vertical/horizontal alignments + the matching grid axis and exclude
   *  diagonals. The two diagonal values (a diagonal guide's own drag, which
   *  can only move its intercept) keep only the matching 45° family, with
   *  grid quantizing the intercept when the full lattice is on. Prevents
   *  guides for snaps the caller would discard. */
  constrain?: SnapConstraint;
  /** Alignment guides in play, ALWAYS-ON targets independent of every mode
   *  toggle (Shift bypasses at the call sites, like all snapping). The caller
   *  passes the visibility-gated pool minus anything moving with the drag. */
  guideTargets?: readonly GuideTarget[];
}

export interface PolygonSnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// All four axis directions (unit vectors): horizontal, vertical, and the two
// 45° diagonals. Used for "Snap to line" (current polygon only).
const ALL_AXES = axesForAllSnap('all');

type Candidate = { target: Vec2; axis: Vec2 };

/**
 * The window inside which two candidates count as equally well aligned. Two
 * colinear targets are mathematically tied, but a diagonal's perpendicular
 * distance runs through a cross product with irrational components, so in
 * floating point they land ~1e-13 apart and which is "closer" flips as the
 * pointer moves. Sitting at 1e-6 (the grid's own epsilon) puts this seven
 * orders above that noise and seven below anything a person could see.
 */
const PERP_TIE_EPS = 1e-6;

/** One resolved alignment: the winning candidate for a single axis family
 *  ({@link axisFamily} — every candidate belongs to exactly one). */
type Lock = {
  family: SnapConstraint;
  /** Perpendicular distance from the engaged anchor to this alignment line.
   *  The admission test, the currency a guide contests in, and what ranks one
   *  family against another. */
  perp: number;
  /** SQUARED distance from the engaged anchor to the target point. Separates
   *  candidates that alignment quality cannot — see {@link PERP_TIE_EPS}. Kept
   *  squared because it is only ever compared, and this is computed per anchor ×
   *  per in-tolerance candidate × per frame in a drag. */
  distSq: number;
  target: Vec2;
  off: Vec2;
  axis: Vec2;
  guideId?: string;
};

// How far off the line through `t` with unit direction `a` the point P sits.
// Against a UNIT axis the cross product IS that perpendicular distance. The
// candidate sweep wants nothing else — it runs per anchor × per candidate ×
// per frame, and only the single surviving winner ever needs a foot, which it
// takes later in the primary frame through snap.ts's `projectOntoAxis` (the
// same projection the stop-snap engine runs, not a second copy of it).
function perpDistTo(p: Vec2, t: Vec2, a: Vec2): number {
  return Math.abs(cross(sub(p, t), a));
}

/**
 * Snap a polygon point (a dragged vertex, or a whole-polygon drag anchor) to
 * its targets along the active snap axes, then to the grid.
 *
 * One winner per axis family, then at most two families lock together. **Any two
 * non-parallel families corner**, a straight axis against a diagonal included —
 * at 135° that is the commonest corner an octolinear map has. Which two is
 * decided by FAMILY and never by ranking them: the straight pair, then the
 * diagonals, then the one mixed pair a lone straight and a lone diagonal leave.
 * Ranking would re-choose the pair as the pointer moved, which is the per-family
 * tie-break's flutter one level up. **Two axes through the SAME target are not a
 * corner**: they cross AT the target, so the lock is really "snap onto this
 * vertex" and holds only within tolerance of it by plain distance. Further out
 * every point is incidentally aligned with two of a target's axes, and one
 * sitting 11 units down a PERFECT horizontal would abandon that zero-error snap
 * to travel onto the vertex. A pair failing that test falls back to the
 * better-aligned axis alone, free slide intact. A right-angle corner displaces
 * the point at most √2× the tolerance; a 135° one reaches 2.6×, which is the
 * price of squaring a corner that is not square. Grid is a **hard constraint**: when on, the
 * result is always on the grid, and a chosen alignment engages only when it can
 * be reconciled with the grid (otherwise it yields to a plain grid snap, no
 * guide) — see {@link reconcileLockWithGrid}/{@link reconcileCorner}. Pure — no
 * React, no DOM.
 */
export function snapPolygonPoint(input: PolygonSnapInput): PolygonSnapResult {
  const { proposed, lineTargets, allTargets, modes, constrain } = input;
  const tol = input.tolerance ?? SNAP_PERP_TOLERANCE;
  const gridInterval = input.gridInterval ?? GRID_INTERVAL;

  // "Snap to grid length" (`tens`): once a single alignment engages, the point
  // keeps one free degree of freedom — sliding along the alignment line. Notch
  // that slide to a whole multiple of the grid length, measured from the
  // target, so the item lands a clean grid-step from the thing it snapped to.
  // Corners have no free DOF; the grid path owns its own quantization (skipped
  // when grid is on); single-DOF edge resizes opt out (a notched perpendicular
  // guide would mislead). `notchAlong` projects the aligned point back onto
  // `axis` through the target, quantizes that distance, and rebuilds the point.
  const applyTens = modes.tens && !constrain;
  const notchAlong = (target: Vec2, point: Vec2, axis: Vec2): Vec2 => {
    const along = dot(sub(point, target), axis);
    const q = Math.round(along / gridInterval) * gridInterval;
    return add(target, scale(axis, q));
  };

  // Single-DOF constraint: a caller with one degree of freedom keeps exactly
  // the one family that moves it and nothing else — a vertical alignment axis
  // locks X, so 'x' keeps the verticals and an x/y caller gets no diagonals at
  // all (they move both), while a diagonal caller keeps its own 45° family.
  // That is plain equality because `constrain` and {@link axisFamily} are the
  // same four values: an axis and the DOF it locks are one fact.
  const axisAllowed = (a: Vec2): boolean => !constrain || axisFamily(a) === constrain;
  // Grid narrows to the constrained axis the same way ('x' keeps vertical grid
  // lines, which lock X) — `constrainedGridMode`, shared with the guide drag,
  // which asks the same question of its own one DOF.
  const diagonalConstrain =
    constrain === 'diagonal-down' || constrain === 'diagonal-up' ? constrain : null;
  const gridMode: GridSnap = constrainedGridMode(modes.grid, constrain);

  const candidates: Candidate[] = [];
  if (modes.line) {
    for (const t of lineTargets)
      for (const axis of ALL_AXES) if (axisAllowed(axis)) candidates.push({ target: t, axis });
  }
  if (modes.all !== 'off') {
    const axes = axesForAllSnap(modes.all).filter(axisAllowed);
    for (const t of allTargets) for (const axis of axes) candidates.push({ target: t, axis });
  }

  // Anchors: the rigid point set generating candidates (default: just the
  // primary). Every engagement below converts to the primary's frame through
  // the engaged anchor's fixed offset `off`, so a hit on ANY anchor moves the
  // whole set by one translation; `off` rides the winner so guides, tens and
  // measurement labels can speak from the corner that actually aligned.
  const anchorPts = input.anchors ?? [proposed];

  // One best candidate per axis family. Points and guides are kept apart
  // because they are judged differently: among points, equally-aligned
  // candidates are separated by PROXIMITY, while a guide can only ever be
  // judged on alignment — its stand-in target is the drag's own foot, so its
  // distance-to-target IS its perpendicular distance and it would win every
  // proximity contest by construction.
  const pointsByFamily = new Map<SnapConstraint, Lock[]>();
  const guideLocks = new Map<SnapConstraint, Lock>();

  const offerPoint = (lock: Lock) => {
    const cs = pointsByFamily.get(lock.family);
    if (cs) cs.push(lock);
    else pointsByFamily.set(lock.family, [lock]);
  };
  const offerGuide = (lock: Lock) => {
    const cur = guideLocks.get(lock.family);
    if (!cur || lock.perp < cur.perp) guideLocks.set(lock.family, lock);
  };

  for (const a of anchorPts) {
    const off = sub(a, proposed);
    for (const { target, axis } of candidates) {
      const perpDist = perpDistTo(a, target, axis);
      if (perpDist > tol) continue;
      offerPoint({
        family: axisFamily(axis),
        perp: perpDist,
        distSq: (a.x - target.x) ** 2 + (a.y - target.y) ** 2,
        target,
        off,
        axis,
      });
    }
  }

  // Alignment guides: always-on candidates, independent of every mode toggle.
  // A horizontal guide is a horizontal alignment axis (locks Y); its stand-in
  // `target` is the engaged anchor's foot on the guide line.
  for (const a of anchorPts) {
    const off = sub(a, proposed);
    for (const g of input.guideTargets ?? []) {
      const axis = guideAxis(g.orientation);
      if (!axisAllowed(axis)) continue;
      const d = guidePerpDist(g.orientation, g.offset, a);
      if (d > tol) continue;
      const foot = guideFoot(g.orientation, g.offset, a);
      // A bounded guide attracts only where the foot lands inside its span —
      // the ANCHOR's foot: the engaged corner is what aligns to the guide.
      if (!guideAdmitsFoot(g, foot)) continue;
      // A guide's distance to its target IS its perpendicular distance — the
      // foot is the target — which is exactly why guides are judged on
      // alignment alone rather than through the proximity tie-break.
      offerGuide({
        family: axisFamily(axis),
        perp: d,
        distSq: d * d,
        target: foot,
        off,
        axis,
        guideId: g.id,
      });
    }
  }

  // Resolve a family in TWO passes: the best alignment it has, then the nearest
  // target among those matching it within the tie window. Measuring that window
  // against the family MINIMUM — never against a running incumbent — is what
  // makes the pick independent of the order the caller assembled its pool in.
  // Epsilon-equality is not transitive, so folding pairwise would let a chain of
  // near-ties walk the winner arbitrarily far off the best alignment, and would
  // let a candidate genuinely tied with the best lose to one that is not tied at
  // all. The winner carries the measurement label and the `tens` notch origin,
  // so an order-dependent pick is a visibly different snap, not just chrome.
  const bestPointFor = (f: SnapConstraint): Lock | null => {
    const cs = pointsByFamily.get(f);
    if (!cs) return null;
    let minPerp = Infinity;
    for (const c of cs) if (c.perp < minPerp) minPerp = c.perp;
    let best: Lock | null = null;
    for (const c of cs) {
      if (c.perp - minPerp > PERP_TIE_EPS) continue;
      if (!best || c.distSq < best.distSq) best = c;
    }
    return best;
  };

  // Per family, a guide takes the slot only by being better aligned than the
  // best point candidate — the exception that keeps a parallel guide from
  // yanking the point off a near-perfect alignment with a real target.
  const winnerFor = (f: SnapConstraint): Lock | null => {
    const p = bestPointFor(f);
    const g = guideLocks.get(f) ?? null;
    if (!p) return g;
    if (!g) return p;
    return g.perp < p.perp ? g : p;
  };
  // The slots, named for the DOF each family locks: `lockX` is the vertical
  // alignments, `lockY` the horizontals.
  const lockX = winnerFor('x');
  const lockY = winnerFor('y');
  const dDown = winnerFor('diagonal-down');
  const dUp = winnerFor('diagonal-up');

  const gridOn = gridMode !== 'off';
  // Grid is a hard constraint: when an alignment can't be reconciled with the
  // grid it yields entirely and we snap purely to grid (no guide).
  const plainGrid = (): PolygonSnapResult => {
    if (!gridOn) return { x: proposed.x, y: proposed.y, guides: [] };
    if (diagonalConstrain) {
      // A diagonal 1-DOF caller only reads the intercept back, so quantize
      // THAT — the intercepts whose lines pass through lattice crossings are
      // the whole-interval ones. Rounding x and y separately would sometimes
      // land the second-nearest intercept (the two roundings can disagree
      // near half-cell boundaries).
      const c = guideOffsetOf(diagonalConstrain, proposed);
      const q = Math.round(c / gridInterval) * gridInterval;
      const p = guideFoot(diagonalConstrain, q, proposed);
      return { x: p.x, y: p.y, guides: [] };
    }
    const g = snapPointToGrid(proposed.x, proposed.y, gridMode, gridInterval);
    return { x: g.x, y: g.y, guides: [] };
  };
  // Same distance readout as the station engine's guides, so every alignment
  // guide in the app carries a measurement label in the same format.
  const guideTo = (target: Vec2, p: Vec2): SnapGuide => ({
    from: { ...target },
    to: { ...p },
    label: formatMeasurement(Math.hypot(p.x - target.x, p.y - target.y)),
  });
  // Like guideTo, but drops a zero-length guide — a grid-length notch can land
  // the point exactly on its target, and a from==to guide has nothing to show.
  const tensGuide = (target: Vec2, p: Vec2): SnapGuide[] =>
    p.x === target.x && p.y === target.y ? [] : [guideTo(target, p)];
  // A point-target winner draws the labeled segment; an alignment-guide winner
  // emits a MARKER instead (the canvas recolors the guide — see SnapGuide).
  // Both speak from the ENGAGED anchor's final position (p + off), so the
  // chrome lands on the corner that aligned, not on the primary.
  const emit = (best: Lock, p: Vec2): SnapGuide => {
    const pe = add(p, best.off);
    return best.guideId
      ? { from: { ...pe }, to: { ...pe }, alignGuideId: best.guideId }
      : guideTo(best.target, pe);
  };
  // A lock's line in the PRIMARY frame: the engaged anchor must sit on the line
  // through `target`, so the primary sits on the parallel line through
  // `target - off`. That is the form both the grid reconciliation and the
  // two-axis solve take.
  const lineOf = (c: Lock) => sub(c.target, c.off);

  // A corner is two constraints locking both degrees of freedom, and ANY two
  // non-parallel families make one — including a straight axis against a
  // diagonal, which at 135° is the commonest corner an octolinear map has.
  //
  // Which two is decided by FAMILY, never by ranking them: the straight pair
  // first, then the diagonals, then the single mixed pair that one lone
  // straight and one lone diagonal leave. A ranking would re-choose the pair as
  // the pointer moved and the order shuffled, which is the same flutter the
  // per-family tie-break exists to kill, one level up.
  const lone = (a: Lock | null, b: Lock | null) => (a ? (b ? null : a) : b);
  const loneStraight = lone(lockX, lockY);
  const loneDiagonal = lone(dDown, dUp);
  const chosen: [Lock, Lock] | null =
    lockX && lockY
      ? [lockX, lockY]
      : dDown && dUp
        ? [dDown, dUp]
        : loneStraight && loneDiagonal
          ? [loneStraight, loneDiagonal]
          : null;

  // Two axes through the SAME target cross AT that target, so their "corner" is
  // not a corner at all — it is "snap onto this vertex", and it has to be judged
  // as one. Within tolerance of the vertex that is exactly right. Further out it
  // is a trap: every point near a target is incidentally aligned with two of its
  // axes, so a point 11 units away down a PERFECT horizontal would throw that
  // zero-error snap away and travel 11 units onto the vertex. Distance, not
  // perpendicular distance, is the honest test of "near the vertex" — and it
  // asks the engaged anchor, since with a rigid set the two locks can reach one
  // target from different corners, which IS a genuine corner.
  const ontoOneVertex =
    chosen !== null &&
    chosen[0].target.x === chosen[1].target.x &&
    chosen[0].target.y === chosen[1].target.y &&
    chosen[0].off.x === chosen[1].off.x &&
    chosen[0].off.y === chosen[1].off.y;
  const pair = ontoOneVertex && chosen[0].distSq > tol * tol ? null : chosen;
  if (pair) {
    const [first, second] = pair;
    const corner = solveTwoAxisLock(lineOf(first), first.axis, lineOf(second), second.axis);
    if (!gridOn) {
      return { x: corner.x, y: corner.y, guides: [emit(first, corner), emit(second, corner)] };
    }
    // Reconcile the corner with the grid, preferring the better-aligned axis
    // as primary so a degraded corner keeps the stronger of the two.
    const firstIsPrimary = first.perp <= second.perp;
    const primary = firstIsPrimary ? first : second;
    const secondary = firstIsPrimary ? second : first;
    const r = reconcileCorner(
      corner.x,
      corner.y,
      { q: lineOf(primary), axis: primary.axis },
      { q: lineOf(secondary), axis: secondary.axis },
      proposed,
      gridMode,
      gridInterval,
    );
    if (r.kept === 'none') return plainGrid();
    const p: Vec2 = { x: r.x, y: r.y };
    if (r.kept === 'both') {
      return { x: p.x, y: p.y, guides: [emit(first, p), emit(second, p)] };
    }
    return { x: p.x, y: p.y, guides: [emit(r.kept === 'primary' ? primary : secondary, p)] };
  }

  // No corner. Two ways to land here: only ONE family was in tolerance at all,
  // or the pair was vetoed as a collapse onto a single vertex. So this scans
  // all four slots rather than the pair — under the veto a THIRD family may be
  // live and better aligned than either vetoed axis, and it snaps with its free
  // slide intact where the pair would have pinned both DOF. The better-aligned
  // wins, ties going to the straight axes — the order below is the tie-break.
  let single: Lock | null = null;
  for (const c of [lockX, lockY, dDown, dUp]) {
    if (c && (!single || c.perp < single.perp)) single = c;
  }
  if (single) {
    const q = lineOf(single);
    const p = projectOntoAxis(proposed, q, single.axis);
    if (!gridOn) {
      // A guide winner never notches: `tens` measures whole grid lengths FROM
      // the target, and a guide's stand-in target is the drag's own foot —
      // quantizing a distance from yourself means nothing.
      if (applyTens && !single.guideId) {
        // The free DOF runs along the alignment line. Notch the ENGAGED anchor
        // to a whole grid step from the target, then step back to the primary
        // frame.
        const pe = notchAlong(single.target, add(p, single.off), single.axis);
        const notched = sub(pe, single.off);
        return { x: notched.x, y: notched.y, guides: tensGuide(single.target, pe) };
      }
      return { x: p.x, y: p.y, guides: [emit(single, p)] };
    }
    const r = reconcileLockWithGrid(q, single.axis, proposed, gridMode, gridInterval);
    if (!r.engaged) return plainGrid();
    const landed: Vec2 = { x: r.x, y: r.y };
    return { x: landed.x, y: landed.y, guides: [emit(single, landed)] };
  }

  // No alignment engaged — grid is the only thing that can move the point.
  return plainGrid();
}
