/**
 * WebAssembly backend for {@link ./clip}, over `js-angusj-clipper` — the same
 * Angus Johnson Clipper 6 that `clipper-lib` ports to JS, compiled to wasm
 * instead of transpiled.
 *
 * Kept as a separate module so `clip.ts` stays a thin dispatcher and the two
 * engines can be compared head-to-head. Loading is ASYNC (wasm instantiation),
 * while every geometry consumer is synchronous — so the instance is resolved
 * once at startup into a module-level slot, and `clip.ts` falls back to the JS
 * engine until that resolves.
 *
 * NOTE the coordinate convention differs from clipper-lib: this library uses
 * lowercase `{x, y}` IntPoints where clipper-lib uses `{X, Y}`.
 */
import type { ClipperLibWrapper, IntPoint, Paths, PolyNode, ReadonlyPath } from 'js-angusj-clipper';
import type { Face, Ring } from './clip';
import { CLIP_SCALE } from './clipScale';

let lib: ClipperLibWrapper | null = null;

/** The loaded engine, or null while the JS fallback is still in use. */
export const wasmClipper = (): ClipperLibWrapper | null => lib;

/**
 * Load the wasm engine. Idempotent; resolves to the format actually loaded so
 * callers can log/telemeter whether they got true wasm or the asm.js fallback.
 * Never throws — a failure leaves `clip.ts` on the JS engine, which is correct,
 * just slower.
 */
export async function loadWasmClipper(): Promise<'wasm' | 'asmJs' | 'unavailable'> {
  if (lib) return lib.format === 'wasm' ? 'wasm' : 'asmJs';
  try {
    const m = await import('js-angusj-clipper');
    lib = await m.loadNativeClipperLibInstanceAsync(
      m.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
    );
    return lib.format === 'wasm' ? 'wasm' : 'asmJs';
  } catch {
    lib = null;
    return 'unavailable';
  }
}

/** Test seam: drop the loaded instance so the JS engine takes over again. */
export function __resetWasmClipper(): void {
  lib = null;
}

const ARC_TOLERANCE = 0.01 * CLIP_SCALE;

const toInt = (ring: Ring): IntPoint[] =>
  ring.map((p) => ({ x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) }));

const fromInt = (path: ReadonlyPath): Ring =>
  path.map((p) => ({ x: p.x / CLIP_SCALE, y: p.y / CLIP_SCALE }));

type ClipKind = 'intersection' | 'union' | 'difference';

export function wasmExecute(kind: ClipKind, subject: Ring[], clip: Ring[]): Ring[] {
  const w = lib!;
  const solution: Paths = w.clipToPaths({
    clipType: kind as never,
    subjectInputs: [{ data: subject.map(toInt), closed: true }],
    clipInputs: clip.length ? [{ data: clip.map(toInt) }] : [],
    subjectFillType: 'nonZero' as never,
    clipFillType: 'nonZero' as never,
  });
  return solution.map(fromInt);
}

export function wasmOffsetOpenPath(path: Ring, delta: number): Ring[] {
  const w = lib!;
  const solution = w.offsetToPaths({
    delta: delta * CLIP_SCALE,
    arcTolerance: ARC_TOLERANCE,
    miterLimit: 2,
    offsetInputs: [{ data: toInt(path), joinType: 'round' as never, endType: 'openButt' as never }],
  });
  return (solution ?? []).map(fromInt);
}

export function wasmOffsetClosed(
  normalized: Ring[],
  delta: number,
  join: 'round' | 'miter',
): Ring[] {
  const w = lib!;
  const solution = w.offsetToPaths({
    delta: delta * CLIP_SCALE,
    arcTolerance: ARC_TOLERANCE,
    miterLimit: 3,
    offsetInputs: [
      {
        data: normalized.map(toInt),
        joinType: join as never,
        endType: 'closedPolygon' as never,
      },
    ],
  });
  return (solution ?? []).map(fromInt);
}

/**
 * Group rings into connected faces (outer + holes each), matching clipper-lib's
 * `PolyTreeToExPolygons`: an island nested inside a hole becomes its own face.
 */
export function wasmSplitIntoFaces(rings: Ring[]): Face[] {
  const w = lib!;
  const tree = w.clipToPolyTree({
    clipType: 'union' as never,
    subjectInputs: [{ data: rings.map(toInt), closed: true }],
    subjectFillType: 'nonZero' as never,
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

export function wasmPointInFace(p: Vec2Like, face: Face): boolean {
  const w = lib!;
  const ip: IntPoint = { x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) };
  // 0 = outside, 1 = inside, -1 = on boundary (same numbering as clipper-lib).
  if (w.pointInPolygon(ip, toInt(face[0])) === 0) return false;
  for (let i = 1; i < face.length; i++) {
    if (w.pointInPolygon(ip, toInt(face[i])) === 1) return false;
  }
  return true;
}

interface Vec2Like {
  x: number;
  y: number;
}

export function wasmFaceArea(face: Face): number {
  const w = lib!;
  const scale2 = CLIP_SCALE * CLIP_SCALE;
  let area = Math.abs(w.area(toInt(face[0]))) / scale2;
  for (let i = 1; i < face.length; i++) {
    area -= Math.abs(w.area(toInt(face[i]))) / scale2;
  }
  return area;
}
