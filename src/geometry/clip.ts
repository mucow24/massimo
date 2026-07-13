/**
 * Thin typed wrapper around clipper-lib isolating the dependency.
 *
 * All inputs/outputs are WORLD-space rings (Vec2[]); coordinates are scaled to
 * integers internally (CLIP_SCALE), which is what makes exactly-coincident,
 * collinear, and edge-tangent geometry well-defined instead of a robustness
 * failure mode. Every boolean runs with NonZero fill so self-intersecting
 * input (folded stroke outlines) heals solid instead of minting phantom holes.
 */
import * as ClipperLib from 'clipper-lib';
import type { Vec2 } from './vec';

export const CLIP_SCALE = 1000;

/** Arc flattening tolerance for round joins, in scaled integer units. */
const ARC_TOLERANCE = 0.01 * CLIP_SCALE;

/** One closed ring in world space. */
export type Ring = Vec2[];

/** One connected face: outer ring first, then its holes. */
export type Face = Ring[];

const toInt = (ring: Ring): ClipperLib.Path =>
  ring.map((p) => ({ X: Math.round(p.x * CLIP_SCALE), Y: Math.round(p.y * CLIP_SCALE) }));

const fromInt = (path: ClipperLib.Path): Ring =>
  path.map((p) => ({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE }));

function execute(clipType: ClipperLib.ClipType, subject: Ring[], clip: Ring[]): Ring[] {
  if (!subject.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject.map(toInt), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) clipper.AddPaths(clip.map(toInt), ClipperLib.PolyType.ptClip, true);
  const solution: ClipperLib.Paths = [];
  clipper.Execute(
    clipType,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return solution.map(fromInt);
}

/** NonZero union of all input rings (subject-only union). */
export function unionAll(rings: Ring[]): Ring[] {
  return execute(ClipperLib.ClipType.ctUnion, rings, []);
}

/** NonZero intersection a ∩ b. */
export function intersect(a: Ring[], b: Ring[]): Ring[] {
  if (!a.length || !b.length) return [];
  return execute(ClipperLib.ClipType.ctIntersection, a, b);
}

/** NonZero difference a ∖ b. */
export function subtract(a: Ring[], b: Ring[]): Ring[] {
  if (!b.length) return unionAll(a);
  return execute(ClipperLib.ClipType.ctDifference, a, b);
}

/** Stroke an open polyline: round joins, butt end caps, half-width delta. */
export function offsetOpenPath(path: Vec2[], delta: number): Ring[] {
  if (path.length < 2 || delta <= 0) return [];
  const offset = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
  offset.AddPath(toInt(path), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenButt);
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, delta * CLIP_SCALE);
  return solution.map(fromInt);
}

/**
 * Dilate (delta > 0) or erode (delta < 0) closed polygons, round joins.
 * Input rings are orientation-normalized through a NonZero union first, so
 * callers may pass rings of either winding (including [outer, ...holes] faces).
 */
export function offsetClosed(rings: Ring[], delta: number): Ring[] {
  if (!rings.length) return [];
  const normalized = unionAll(rings);
  if (!normalized.length) return [];
  const offset = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
  offset.AddPaths(
    normalized.map(toInt),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, delta * CLIP_SCALE);
  return solution.map(fromInt);
}

/**
 * Group rings into connected faces (outer + holes each). An island inside a
 * hole comes back as its own face (PolyTree flattening).
 */
export function splitIntoFaces(rings: Ring[]): Face[] {
  if (!rings.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(rings.map(toInt), ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  const ex = ClipperLib.JS.PolyTreeToExPolygons(tree);
  return ex.map((e) => [fromInt(e.outer), ...e.holes.map(fromInt)]);
}

/**
 * Hole-aware containment: inside (or on) the outer ring and not strictly
 * inside any hole.
 */
export function pointInFace(p: Vec2, face: Face): boolean {
  if (!face.length) return false;
  const ip: ClipperLib.IntPoint = {
    X: Math.round(p.x * CLIP_SCALE),
    Y: Math.round(p.y * CLIP_SCALE),
  };
  if (ClipperLib.Clipper.PointInPolygon(ip, toInt(face[0])) === 0) return false;
  for (let i = 1; i < face.length; i++) {
    if (ClipperLib.Clipper.PointInPolygon(ip, toInt(face[i])) === 1) return false;
  }
  return true;
}

/** Face area in world units²: |outer| − Σ|holes|. */
export function faceArea(face: Face): number {
  if (!face.length) return 0;
  const scale2 = CLIP_SCALE * CLIP_SCALE;
  let area = Math.abs(ClipperLib.Clipper.Area(toInt(face[0]))) / scale2;
  for (let i = 1; i < face.length; i++) {
    area -= Math.abs(ClipperLib.Clipper.Area(toInt(face[i]))) / scale2;
  }
  return area;
}

/**
 * A point guaranteed strictly inside the face (erosion-based: a vertex of the
 * eroded polygon is at least the erosion depth inside), or null when the face
 * is too thin to erode at any depth down to ~0.001 world units.
 */
export function interiorPoint(face: Face): Vec2 | null {
  for (let depth = 1; depth >= 0.001; depth /= 2) {
    const eroded = offsetClosed(face, -depth);
    if (eroded.length && eroded[0].length) {
      const v = eroded[0][0];
      if (pointInFace(v, face)) return v;
    }
  }
  return null;
}
