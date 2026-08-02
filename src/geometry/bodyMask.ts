/**
 * Coarse occupancy masks for line bodies — the reject that the whole-map body
 * shape makes necessary.
 *
 * `buildLineBodies` unions each line into ONE polygon spanning everywhere that
 * line runs, so its bounding box covers a large fraction of the map (~26% of
 * the world box on the MTA drawing). Every reject built on that box is
 * therefore nearly useless: the zone's pairwise body intersections and
 * `restrictBodiesToZone`'s body-versus-component clip both wave through
 * operands that share a bbox and no territory, and each one marshals a
 * thousand-vertex whole-map polygon to find that out.
 *
 * A mask is the set of grid cells a body actually occupies. It is a strict
 * refinement of the bbox test and nothing more: this module never changes what
 * an operation RETURNS, only whether an operation that would have returned
 * empty is run at all.
 *
 * ## Why skipping is exact
 *
 * The masks are a conservative SUPERSET of their body — every cell holding any
 * part of it is marked (see {@link build} for how, and `bodyMask.test.ts` for
 * the property that pins it against the clipper itself). So `!masksMeet(A, B)`
 * proves A and B share no cell, hence no point, hence `intersect(A, B)` is
 * empty — which is the branch an empty result already takes at both call sites.
 *
 * {@link dirtyReaches} extends the same reasoning across FRAMES. Outside the
 * dirty region both bodies are identical to the previous frame's, so a point
 * where their intersection differs must lie in a dirty cell AND in both
 * bodies. If no such cell exists, last frame's rings are still exactly the
 * answer. Callers must test the OLD masks as well as the new: an overlap that
 * VACATED a dirty cell changes the result just as much as one that arrived,
 * and only the old masks can see it.
 *
 * "Exactly the answer" means the same REGION, at the same resolution — which
 * is the equivalence the region caches already run on, not a byte compare. A
 * body is re-unioned whole when its line is dirty, and clipper is free to emit
 * an unchanged polygon rotated to a different first vertex when unrelated
 * input moved, so a reused pair result can differ from a fresh intersect by a
 * ring rotation. That is precisely what `hashRingCanonical` was written to
 * absorb, and it is strictly on the safe side here: the alternative is
 * `ringsContentEqual`'s rotation-SENSITIVE compare marking the pair changed,
 * which its own note calls out as only ever costing a missed reuse. The pair
 * parts are unioned by `zoneComponents` and the components are ordered by
 * content key, so no downstream boolean can see the difference.
 *
 * Cell keys pack two signed cell indices into one number. That packing can
 * alias for absurd coordinates, and aliasing is harmless by construction: it
 * can only make two distinct cells look like one, which adds spurious
 * overlaps. Extra overlap costs a skipped skip; it can never hide a real one.
 */
import type { Ring } from './clip';

/**
 * Cell size in world units. Well above a line's painted width (8-16), so a body
 * occupies few cells per unit length and the mask stays small; well below the
 * distance between unrelated crossings, so two lines that merely share a bbox
 * separate cleanly.
 */
export const MASK_CELL = 32;

const cellKey = (cx: number, cy: number): number => cx * 100000 + cy;

/** Add every cell a box covers. Used to turn the incremental builder's dirty
 *  unit boxes into the dirty cell set. */
export const cellsOfBox = (
  b: { x0: number; y0: number; x1: number; y1: number },
  out: Set<number>,
): void => {
  const x0 = Math.floor(b.x0 / MASK_CELL);
  const x1 = Math.floor(b.x1 / MASK_CELL);
  const y0 = Math.floor(b.y0 / MASK_CELL);
  const y1 = Math.floor(b.y1 / MASK_CELL);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(cellKey(x, y));
};

/**
 * Two passes, and both are needed for the superset guarantee.
 *
 * A cell holding part of the body either has boundary running through it or is
 * wholly interior. The EDGE pass covers the first case: every cell an edge's
 * bounding box touches is marked, which is a superset of the cells the edge
 * crosses. The FILL pass covers the second: a wholly-interior cell spans its
 * whole row, so each of the sampled scanlines crosses it, and on such a line
 * the cell lies between a pair of boundary crossings. Crossings use the
 * half-open rule (`min <= y < max`), which counts a vertex exactly once and so
 * keeps the crossing count even — that is what makes the even-odd pairing
 * sound on clipper output, whose rings are non-self-intersecting and properly
 * nested.
 *
 * Edges are bucketed by the rows they span before the fill runs. Testing every
 * edge against every row instead is ~90 rows x ~1200 edges x 3 samples per
 * dirty line per frame, which measured at roughly two thirds of the win this
 * module exists to produce.
 */
function build(rings: Ring[]): Set<number> {
  const cells = new Set<number>();
  if (!rings.length) return cells;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      const x0 = Math.floor(Math.min(p.x, q.x) / MASK_CELL);
      const x1 = Math.floor(Math.max(p.x, q.x) / MASK_CELL);
      const y0 = Math.floor(Math.min(p.y, q.y) / MASK_CELL);
      const y1 = Math.floor(Math.max(p.y, q.y) / MASK_CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.add(cellKey(x, y));
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const rowLo = Math.floor(minY / MASK_CELL);
  const rowHi = Math.floor(maxY / MASK_CELL);
  const buckets: { py: number; px: number; qy: number; qx: number }[][] = new Array(
    rowHi - rowLo + 1,
  );
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      if (p.y === q.y) continue; // horizontal edges cross no scanline
      const lo = Math.max(rowLo, Math.floor(Math.min(p.y, q.y) / MASK_CELL));
      const hi = Math.min(rowHi, Math.floor(Math.max(p.y, q.y) / MASK_CELL));
      const e = { py: p.y, px: p.x, qy: q.y, qx: q.x };
      for (let row = lo; row <= hi; row++) (buckets[row - rowLo] ??= []).push(e);
    }
  }
  const xs: number[] = [];
  for (let row = rowLo; row <= rowHi; row++) {
    const bucket = buckets[row - rowLo];
    if (!bucket) continue;
    // Three samples per row: the middle plus both extremes, so a shape that
    // only reaches into part of the row's height is still caught.
    for (const frac of [0.5, 0.02, 0.98]) {
      const y = (row + frac) * MASK_CELL;
      xs.length = 0;
      for (const e of bucket) {
        if (y < Math.min(e.py, e.qy) || y >= Math.max(e.py, e.qy)) continue;
        xs.push(e.px + ((y - e.py) / (e.qy - e.py)) * (e.qx - e.px));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const cx0 = Math.floor(xs[k] / MASK_CELL);
        const cx1 = Math.floor(xs[k + 1] / MASK_CELL);
        for (let x = cx0; x <= cx1; x++) cells.add(cellKey(x, row));
      }
    }
  }
  return cells;
}

/**
 * Memoized per ring-ARRAY identity. `buildLineBodies` hands back the previous
 * frame's array by reference for every clean line, so an untouched body never
 * re-masks — the same bargain the render memos and `stripePathFor` make.
 */
const masks = new WeakMap<object, Set<number>>();
export function bodyMask(rings: Ring[]): Set<number> {
  let m = masks.get(rings);
  if (!m) masks.set(rings, (m = build(rings)));
  return m;
}

/** Do two masks share a cell? False proves the two bodies cannot intersect. */
export function masksMeet(a: Set<number>, b: Set<number>): boolean {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const c of s) if (l.has(c)) return true;
  return false;
}

/**
 * Is any DIRTY cell occupied by both masks? False proves the two bodies'
 * intersection is unchanged since the frame those masks describe — see the
 * module header for why callers must ask this of the old masks too.
 */
export function dirtyReaches(dirty: Set<number>, a: Set<number>, b: Set<number>): boolean {
  if (dirty.size <= a.size && dirty.size <= b.size) {
    for (const c of dirty) if (a.has(c) && b.has(c)) return true;
    return false;
  }
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const c of s) if (dirty.has(c) && l.has(c)) return true;
  return false;
}
