/**
 * Thin typed wrapper isolating the polygon-boolean dependency.
 *
 * ONE ENGINE: `js-angusj-clipper` — Angus Johnson's Clipper 6 compiled to
 * WebAssembly, with that library's own asm.js build as a fallback. Those two
 * are the SAME C++ doing the SAME integer arithmetic, just compiled twice, so
 * they agree exactly; picking either is invisible to everything downstream.
 *
 * There was briefly a second engine here, `clipper-lib` — a hand-written JS
 * port of the same algorithm — kept as a synchronous fallback while wasm
 * loaded. It is gone on purpose. It is a DIFFERENT implementation whose output
 * drifts ~0.01 world units, `regionAssignments` bind to arrangement faces on
 * exact geometry, and nothing exercised it, so its only possible effect was to
 * silently rebind a document's regions on a machine where wasm failed. One
 * engine that fails loudly beats two that quietly disagree.
 *
 * Loading is ASYNC and every consumer here is synchronous, so the instance is
 * resolved once into a module slot before anything draws — `main.tsx` awaits it
 * before mounting, `src/test/setup.ts` before any test runs. Calling in before
 * that throws {@link ClipperUnavailableError} rather than dereferencing null
 * somewhere deep in a geometry pass.
 *
 * All inputs/outputs are WORLD-space rings (Vec2[]); coordinates are scaled to
 * integers internally (CLIP_SCALE), which is what makes exactly-coincident,
 * collinear, and edge-tangent geometry well-defined instead of a robustness
 * failure mode. Every boolean runs with NonZero fill so self-intersecting
 * input (folded stroke outlines) heals solid instead of minting phantom holes.
 */
import type {
  ClipType,
  ClipperLibWrapper,
  EndType,
  IntPoint,
  JoinType,
  Paths,
  PolyFillType,
  PolyNode,
  ReadonlyPath,
} from 'js-angusj-clipper';
import type { Vec2 } from './vec';

/**
 * The fixed-point scale every clipper operation runs at. World coordinates are
 * multiplied by this and rounded to integers before any boolean.
 */
export const CLIP_SCALE = 1000;

/** Arc flattening tolerance for round joins, in scaled integer units. */
const ARC_TOLERANCE = 0.01 * CLIP_SCALE;

/** One closed ring in world space. */
export type Ring = Vec2[];

/** One connected face: outer ring first, then its holes. */
export type Face = Ring[];

/** Thrown when the engine is missing, or used before it finished loading. */
export class ClipperUnavailableError extends Error {
  /** The underlying load failure, when there was one. */
  readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'ClipperUnavailableError';
    this.reason = reason;
  }
}

let lib: ClipperLibWrapper | null = null;

/**
 * Load the engine. Idempotent; resolves to the format actually loaded so
 * callers can log which one they got. REJECTS if neither build loads — there is
 * no second implementation to degrade to, and a caller that ignored this would
 * fail far away from the cause.
 */
export async function loadClipper(): Promise<'wasm' | 'asmJs'> {
  if (!lib) {
    try {
      const m = await import('js-angusj-clipper');
      lib = await m.loadNativeClipperLibInstanceAsync(
        m.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
      );
    } catch (cause) {
      throw new ClipperUnavailableError('Could not load the polygon clipping engine', cause);
    }
  }
  return lib.format === 'wasm' ? 'wasm' : 'asmJs';
}

/** Test seam: forget the loaded instance so the unloaded path can be exercised. */
export function __resetClipper(): void {
  lib = null;
}

function engine(): ClipperLibWrapper {
  if (!lib) {
    throw new ClipperUnavailableError('clip.ts was used before loadClipper() resolved');
  }
  return lib;
}

/**
 * The library types its options as string ENUMS. Importing the enum VALUES
 * would make `js-angusj-clipper` a static dependency of this module and haul
 * the whole engine into the entry chunk, defeating the dynamic import above —
 * so the literals are written out and cast. `clip.engine.test.ts` asserts each
 * one still equals its enum member, which is the check this cast gives up.
 */
const as = <T>(literal: string): T => literal as unknown as T;

const toInt = (ring: Ring): IntPoint[] =>
  ring.map((p) => ({ x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) }));

const fromInt = (path: ReadonlyPath): Ring =>
  path.map((p) => ({ x: p.x / CLIP_SCALE, y: p.y / CLIP_SCALE }));

const NON_ZERO = as<PolyFillType>('nonZero');

function execute(kind: 'intersection' | 'union' | 'difference', subject: Ring[], clip: Ring[]) {
  if (!subject.length) return [];
  const solution: Paths = engine().clipToPaths({
    clipType: as<ClipType>(kind),
    subjectInputs: [{ data: subject.map(toInt), closed: true }],
    clipInputs: clip.length ? [{ data: clip.map(toInt) }] : [],
    subjectFillType: NON_ZERO,
    clipFillType: NON_ZERO,
  });
  return solution.map(fromInt);
}

/** NonZero union of all input rings (subject-only union). */
export function unionAll(rings: Ring[]): Ring[] {
  return execute('union', rings, []);
}

/** NonZero intersection a ∩ b. */
export function intersect(a: Ring[], b: Ring[]): Ring[] {
  if (!a.length || !b.length) return [];
  return execute('intersection', a, b);
}

/** NonZero difference a ∖ b. */
export function subtract(a: Ring[], b: Ring[]): Ring[] {
  if (!b.length) return unionAll(a);
  return execute('difference', a, b);
}

/** Stroke an open polyline: round joins, butt end caps, half-width delta. */
export function offsetOpenPath(path: Vec2[], delta: number): Ring[] {
  if (path.length < 2 || delta <= 0) return [];
  const solution = engine().offsetToPaths({
    delta: delta * CLIP_SCALE,
    arcTolerance: ARC_TOLERANCE,
    miterLimit: 2,
    offsetInputs: [
      { data: toInt(path), joinType: as<JoinType>('round'), endType: as<EndType>('openButt') },
    ],
  });
  return (solution ?? []).map(fromInt);
}

/**
 * Dilate (delta > 0) or erode (delta < 0) closed polygons. Joins default to
 * round (a true Minkowski disc sum); 'miter' keeps the offset boundary
 * parallel to the input edges THROUGH corners (extending them to their
 * intersection, limit 3) — used where the dilation boundary must align with
 * offsets of the same edges elsewhere (region exclusion holes). Input rings
 * are orientation-normalized through a NonZero union first, so callers may
 * pass rings of either winding (including [outer, ...holes] faces).
 */
export function offsetClosed(
  rings: Ring[],
  delta: number,
  join: 'round' | 'miter' = 'round',
): Ring[] {
  if (!rings.length) return [];
  const normalized = unionAll(rings);
  if (!normalized.length) return [];
  const solution = engine().offsetToPaths({
    delta: delta * CLIP_SCALE,
    arcTolerance: ARC_TOLERANCE,
    miterLimit: 3,
    offsetInputs: [
      {
        data: normalized.map(toInt),
        joinType: as<JoinType>(join),
        endType: as<EndType>('closedPolygon'),
      },
    ],
  });
  return (solution ?? []).map(fromInt);
}

/**
 * Group rings into connected faces (outer + holes each). An island inside a
 * hole comes back as its own face (PolyTree flattening).
 */
export function splitIntoFaces(rings: Ring[]): Face[] {
  if (!rings.length) return [];
  const tree = engine().clipToPolyTree({
    clipType: as<ClipType>('union'),
    subjectInputs: [{ data: rings.map(toInt), closed: true }],
    subjectFillType: NON_ZERO,
  });
  const out: Face[] = [];
  const emitOuter = (node: PolyNode): void => {
    const face: Face = [fromInt(node.contour)];
    for (const hole of node.childs) {
      face.push(fromInt(hole.contour));
      // Children of a hole are nested outer polygons — separate faces.
      for (const nested of hole.childs) emitOuter(nested);
    }
    out.push(face);
  };
  for (const node of tree.childs) emitOuter(node);
  return out;
}

/**
 * Hole-aware containment: inside (or on) the outer ring and not strictly
 * inside any hole.
 */
export function pointInFace(p: Vec2, face: Face): boolean {
  if (!face.length) return false;
  const w = engine();
  const ip: IntPoint = { x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) };
  // 0 = outside, 1 = inside, -1 = on boundary.
  if (w.pointInPolygon(ip, toInt(face[0])) === 0) return false;
  for (let i = 1; i < face.length; i++) {
    if (w.pointInPolygon(ip, toInt(face[i])) === 1) return false;
  }
  return true;
}

/**
 * Shoelace over the ring's CLIP_SCALE integer coordinates — the same
 * arithmetic the engine's own Area() runs, kept in JS to spare a wasm
 * round-trip per ring (faceArea runs per component per frame). Translating
 * by the first vertex keeps every product within 2^53, so the sum is exact
 * and the result is bit-identical to the engine's.
 */
function ringAreaInt(ring: Ring): number {
  if (ring.length < 3) return 0;
  const x0 = Math.round(ring[0].x * CLIP_SCALE);
  const y0 = Math.round(ring[0].y * CLIP_SCALE);
  let sum = 0;
  let px = 0;
  let py = 0;
  for (let i = 1; i < ring.length; i++) {
    const qx = Math.round(ring[i].x * CLIP_SCALE) - x0;
    const qy = Math.round(ring[i].y * CLIP_SCALE) - y0;
    sum += px * qy - qx * py;
    px = qx;
    py = qy;
  }
  return sum / 2;
}

/** Face area in world units²: |outer| − Σ|holes|. */
export function faceArea(face: Face): number {
  if (!face.length) return 0;
  const scale2 = CLIP_SCALE * CLIP_SCALE;
  let area = Math.abs(ringAreaInt(face[0])) / scale2;
  for (let i = 1; i < face.length; i++) {
    area -= Math.abs(ringAreaInt(face[i])) / scale2;
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
