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
/** The load itself, memoized IN FLIGHT — see {@link loadClipper}. */
let libPromise: Promise<'wasm' | 'asmJs'> | null = null;

async function load(): Promise<'wasm' | 'asmJs'> {
  let instance: ClipperLibWrapper;
  try {
    const m = await import('js-angusj-clipper');
    instance = await m.loadNativeClipperLibInstanceAsync(
      m.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
    );
  } catch (cause) {
    throw new ClipperUnavailableError('Could not load the polygon clipping engine', cause);
  }
  lib = instance;
  return instance.format === 'wasm' ? 'wasm' : 'asmJs';
}

/**
 * Load the engine. Idempotent; resolves to the format actually loaded so
 * callers can log which one they got. REJECTS if neither build loads — there is
 * no second implementation to degrade to, and a caller that ignored this would
 * fail far away from the cause.
 *
 * The memo is the PROMISE, and every caller gets that same promise back.
 * Guarding on the resolved instance instead would leave the load window itself
 * unguarded: `main.tsx` and `src/test/setup.ts` both call this, and two callers
 * arriving before the first resolve would each compile their own wasm module —
 * megabytes of duplicate startup work — with the loser's instance then
 * replacing the winner's in the slot every synchronous consumer reads.
 */
export function loadClipper(): Promise<'wasm' | 'asmJs'> {
  if (!libPromise) {
    // A FAILED load is not memoized: the slot clears so the next call retries
    // rather than replaying one rejection for the life of the page.
    libPromise = load().catch((err: unknown) => {
      libPromise = null;
      throw err;
    });
  }
  return libPromise;
}

/** Test seam: forget the loaded engine so the unloaded path can be exercised. */
export function __resetClipper(): void {
  lib = null;
  libPromise = null;
}

/**
 * Bytes of wasm linear memory the engine is holding, or 0 if it has not
 * loaded. Instrumentation only — the emscripten heap GROWS and never shrinks,
 * so this is the number that says whether a session's slowdown lives on the
 * wasm side. The property is off-contract (emscripten's, not the wrapper's),
 * hence the defensive probe rather than a typed read.
 */
export function clipperHeapBytes(): number {
  const native = lib?.instance as unknown as
    | { HEAPU8?: { buffer?: ArrayBuffer }; wasmMemory?: { buffer?: ArrayBuffer } }
    | undefined;
  return native?.HEAPU8?.buffer?.byteLength ?? native?.wasmMemory?.buffer?.byteLength ?? 0;
}

/**
 * Instrumentation seam: the raw emscripten module behind the wrapper, or null
 * before it loads. Exposed ONLY so a harness can probe the allocator — heap
 * SIZE (above) cannot tell a leak from fragmentation, and answering that needs
 * `_malloc`/`_free` directly. Nothing in the app may use this.
 */
export function __clipperNativeInstance(): {
  _malloc?: (n: number) => number;
  _free?: (p: number) => void;
} | null {
  return (lib?.instance as unknown as { _malloc?: (n: number) => number } | undefined) ?? null;
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
  return offsetNormalized(normalized, delta, join);
}

/**
 * {@link offsetClosed} minus the normalization union, for rings that are
 * ALREADY engine output (boolean / polytree results): their winding is
 * consistent by the engine's own convention, so re-unioning them is one
 * redundant boolean per call — and this runs per face per frame in the
 * sliver-opening morphology. Rings that are NOT engine output (hand-built,
 * or concatenations of separate outputs that may overlap) must use
 * offsetClosed: for those the union is load-bearing — a negative delta does
 * not distribute over overlapping rings.
 */
export function offsetNormalized(
  rings: Ring[],
  delta: number,
  join: 'round' | 'miter' = 'round',
): Ring[] {
  if (!rings.length) return [];
  const solution = engine().offsetToPaths({
    delta: delta * CLIP_SCALE,
    arcTolerance: ARC_TOLERANCE,
    miterLimit: 3,
    offsetInputs: [
      {
        data: rings.map(toInt),
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
  // Faces here are always engine output (arrangement faces), so the
  // normalization-free offset is safe — and this halving loop can run the
  // offset up to ten times per call.
  for (let depth = 1; depth >= 0.001; depth /= 2) {
    const eroded = offsetNormalized(face, -depth);
    if (eroded.length && eroded[0].length) {
      const v = eroded[0][0];
      if (pointInFace(v, face)) return v;
    }
  }
  return null;
}
