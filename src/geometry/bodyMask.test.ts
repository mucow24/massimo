import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { bodyMask, cellsOfBox, dirtyReaches, masksMeet, MASK_CELL } from './bodyMask';
import { CLIP_SCALE, intersect, offsetClosed, subtract, unionAll, type Ring } from './clip';

/**
 * The mask is only allowed to skip work that would have returned nothing. Two
 * claims carry that, and both are checked here against the clipper itself
 * rather than argued:
 *
 *   1. `!masksMeet(A, B)`  ⇒  `intersect(A, B)` is empty.
 *   2. no dirty cell in both masks (old AND new)  ⇒  the pair's intersection
 *      covers the same REGION as the previous frame's. Not the same
 *      coordinates — see {@link same} for the difference, which is forced by
 *      the engine and not by anything the reject does.
 *
 * A mask that under-covers its body breaks (1) immediately: the generators
 * below produce blobs far wider than a cell, so the scanline fill — the half
 * of the build that covers wholly-interior cells — is exercised, not just the
 * edge pass.
 */

const rect = (x: number, y: number, w: number, h: number): Ring => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** A rect rotated about its own centre. Real bodies are arc-flattened stroke
 *  outlines — overwhelmingly short DIAGONAL edges — so a generator that only
 *  emits axis-aligned ones would leave the fill's crossing arithmetic and the
 *  edge pass's bbox cover untested on the geometry they actually meet. */
const rotRect = (x: number, y: number, w: number, h: number, deg: number): Ring => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return rect(x, y, w, h).map((p) => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  }));
};

/**
 * The PARTS a blob is unioned from, kept reachable because the cross-frame
 * properties have to build both frames' bodies the way `buildLineBodies` does:
 * each a fresh union of raw parts. Growing one frame's body out of the OTHER
 * frame's output is a different operation and one the builder never performs —
 * `unionAll` is not idempotent on a body whose rings touch along an edge (it
 * merges them, pinned below), so a generator that did it would manufacture
 * ring-count differences no frame transition can produce.
 */
const partsArb = (cx: number, cy: number, spread: number) =>
  fc
    .array(
      fc.record({
        dx: fc.integer({ min: -spread, max: spread }),
        dy: fc.integer({ min: -spread, max: spread }),
        w: fc.integer({ min: 4, max: 120 }),
        h: fc.integer({ min: 4, max: 120 }),
        // Half axis-aligned, half rotated, deliberately. Rotated parts are
        // what a real arc-flattened body looks like; axis-aligned ones are
        // what produce cells with NO boundary in them, which is the only
        // thing that exercises the scanline fill. A generator that is all
        // diagonals stops catching a deleted fill.
        rot: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 89 })),
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((parts) => parts.map((p) => rotRect(cx + p.dx, cy + p.dy, p.w, p.h, p.rot)));

/** A blob: several overlapping rectangles unioned, i.e. the same shape of
 *  input a line body is — clipper output, non-self-intersecting, possibly
 *  holed, and much wider than one cell. */
const blobArb = (cx: number, cy: number, spread: number) => partsArb(cx, cy, spread).map(unionAll);

const cellsOf = (b: { x0: number; y0: number; x1: number; y1: number }) => {
  const s = new Set<number>();
  cellsOfBox(b, s);
  return s;
};

/**
 * "The same answer", at the only resolution the engine can express it in.
 *
 * A coordinate compare cannot be the oracle here, and not because the reject
 * is sloppy. Clipper works in fixed point at `CLIP_SCALE`, and its output is a
 * function of the INPUT VERTEX LIST, not of the region that list describes.
 * Geometry that changes between frames can SPLIT a body's boundary edge; the
 * split vertex is rounded onto the integer grid, which tilts the surviving
 * fragment by a fraction of a unit, and a crossing anywhere along that
 * fragment — arbitrarily far from the change, in cells the change never
 * touches — then rounds to a different integer. `a re-split edge moves a far
 * crossing by one clipper unit` below pins the case that found this: the
 * change sits at the origin, the vertex that moves is 20 units away. Nothing
 * local predicts it, so no spatial reject can promise identical coordinates —
 * this one included, and any replacement for it too.
 *
 * What a reject can promise is the REGION, which is what this asks: neither
 * side holds territory the other lacks, judged by the engine, after eroding by
 * one `CLIP_SCALE` unit — the last place two coordinates can differ at all.
 * That is not a tolerance dial. It still fails a real difference: a 0.01-unit
 * drift is caught, and 0.01 is the magnitude that got the second clipper
 * engine deleted (see clip.ts). Ring ROTATIONS, which clipper emits freely
 * when unrelated input moved and which a coordinate compare reports as
 * differences, have no symmetric difference at all and pass.
 */
const same = (a: Ring[], b: Ring[]) =>
  offsetClosed(subtract(a, b), -1 / CLIP_SCALE).length === 0 &&
  offsetClosed(subtract(b, a), -1 / CLIP_SCALE).length === 0;

describe('bodyMask — the reject is exact', () => {
  it('mask-disjoint bodies never intersect (100 runs)', () => {
    fc.assert(
      fc.property(blobArb(0, 0, 200), blobArb(0, 0, 200), (A, B) => {
        if (!A.length || !B.length) return true;
        if (masksMeet(bodyMask(A), bodyMask(B))) return true; // says "maybe" — no claim
        // Says "never". The clipper must agree.
        return intersect(A, B).length === 0;
      }),
      { numRuns: 100 },
    );
  });

  it('bodies deliberately placed far apart are rejected (the win is real)', () => {
    // Guards against a mask so coarse it always overlaps: if this ever starts
    // failing, the reject has stopped rejecting and the property above is
    // passing vacuously.
    const A = unionAll([rect(0, 0, 60, 60)]);
    const B = unionAll([rect(500, 500, 60, 60)]);
    expect(masksMeet(bodyMask(A), bodyMask(B))).toBe(false);
    expect(intersect(A, B)).toEqual([]);
  });

  it('covers a cell strictly inside a wide blob, where no edge runs', () => {
    // A 200x200 square: its middle cells hold no boundary at all, so only the
    // scanline fill can mark them. Deleting the fill fails this.
    const A = unionAll([rect(0, 0, 200, 200)]);
    const B = unionAll([rect(96, 96, 8, 8)]); // entirely interior, touches no edge
    expect(intersect(A, B).length).toBeGreaterThan(0);
    expect(masksMeet(bodyMask(A), bodyMask(B))).toBe(true);
  });

  it('a body narrower than a cell is still covered', () => {
    const A = unionAll([rect(0, 0, 300, 3)]); // a hairline, thinner than MASK_CELL
    const B = unionAll([rect(150, 1, 4, 1)]);
    expect(intersect(A, B).length).toBeGreaterThan(0);
    expect(masksMeet(bodyMask(A), bodyMask(B))).toBe(true);
  });

  it('works across the origin, where cell indices go negative', () => {
    const A = unionAll([rect(-100, -100, 200, 200)]);
    const B = unionAll([rect(-10, -10, 20, 20)]);
    expect(masksMeet(bodyMask(A), bodyMask(B))).toBe(true);
    expect(masksMeet(bodyMask(A), bodyMask(unionAll([rect(-900, -900, 20, 20)])))).toBe(false);
  });
});

describe('bodyMask — dirtyReaches is exact across frames', () => {
  it('no reach ⇒ the pair intersection is unchanged (100 runs)', () => {
    fc.assert(
      fc.property(
        partsArb(0, 0, 150),
        blobArb(0, 0, 150),
        fc.record({
          x: fc.integer({ min: -600, max: 600 }),
          y: fc.integer({ min: -600, max: 600 }),
          w: fc.integer({ min: 8, max: 90 }),
          h: fc.integer({ min: 8, max: 90 }),
        }),
        (aParts, B, patch) => {
          const aOld = unionAll(aParts);
          if (!aOld.length || !B.length) return true;
          // A changes ONLY inside D: a rectangle is added there. Each frame's
          // body is its own union of raw parts, as the builder makes them.
          const D = { x0: patch.x, y0: patch.y, x1: patch.x + patch.w, y1: patch.y + patch.h };
          const aNew = unionAll([...aParts, rect(patch.x, patch.y, patch.w, patch.h)]);
          const dirty = cellsOf(D);
          const mB = bodyMask(B);
          const reaches =
            dirtyReaches(dirty, bodyMask(aNew), mB) || dirtyReaches(dirty, bodyMask(aOld), mB);
          if (reaches) return true; // says "maybe" — no claim
          // Says "unchanged". Clipper must produce the identical rings.
          return same(intersect(aNew, B), intersect(aOld, B));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no reach ⇒ unchanged, when the change REMOVES geometry (100 runs)', () => {
    // The add-only property above cannot see the old-mask half of the
    // soundness argument: geometry that VACATED a dirty cell is invisible to
    // the new mask, so consulting only the new masks would wrongly report
    // "unchanged". Mutation-tested — dropping the old-mask term fails here.
    fc.assert(
      fc.property(
        partsArb(0, 0, 150),
        blobArb(0, 0, 150),
        fc.record({
          x: fc.integer({ min: -400, max: 400 }),
          y: fc.integer({ min: -400, max: 400 }),
          w: fc.integer({ min: 8, max: 90 }),
          h: fc.integer({ min: 8, max: 90 }),
        }),
        (aParts, B, patch) => {
          const aNew = unionAll(aParts);
          if (!aNew.length || !B.length) return true;
          const D = { x0: patch.x, y0: patch.y, x1: patch.x + patch.w, y1: patch.y + patch.h };
          // aOld carried an extra part in D that aNew no longer has.
          const aOld = unionAll([...aParts, rect(patch.x, patch.y, patch.w, patch.h)]);
          const dirty = cellsOf(D);
          const mB = bodyMask(B);
          const reaches =
            dirtyReaches(dirty, bodyMask(aNew), mB) || dirtyReaches(dirty, bodyMask(aOld), mB);
          if (reaches) return true;
          return same(intersect(aNew, B), intersect(aOld, B));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a re-split edge moves a far crossing by one clipper unit', () => {
    // The counterexample the property above found, replayed by hand. A is one
    // long parallelogram; the removed rect overlaps it only in a sliver at the
    // origin, so the union splits A's long left edge there and rounds the
    // split vertex onto the CLIP_SCALE grid. That leaves the surviving
    // fragment a hair off the line it came from — and twenty units away, in a
    // cell the change never touches, B's crossing of it rounds the other way.
    const A = unionAll([
      [
        { x: 86.606, y: 48.002 },
        { x: 58.894, y: 64.002 },
        { x: 10.394, y: -20.002 },
        { x: 38.106, y: -36.002 },
      ],
    ]);
    const B = unionAll([
      [
        { x: 24.315, y: -30.093 },
        { x: 21.597, y: -4.235 },
        { x: 5.685, y: -5.907 },
        { x: 8.403, y: -31.765 },
      ],
    ]);
    const aOld = unionAll([...A, rect(0, 0, 22, 8)]);
    const dirty = cellsOf({ x0: 0, y0: 0, x1: 22, y1: 8 });
    // The reject fires, and correctly: B holds no dirty cell in either frame,
    // and as point sets the removed rect and B are disjoint outright.
    expect(dirtyReaches(dirty, bodyMask(A), bodyMask(B))).toBe(false);
    expect(dirtyReaches(dirty, bodyMask(aOld), bodyMask(B))).toBe(false);
    // The coordinates nonetheless differ, by exactly one unit at one vertex.
    // This is the whole reason `same` is stated on the region: no reject can
    // see this coming, because nothing near the overlap changed.
    expect(intersect(A, B)[0]).toContainEqual({ x: 19.362, y: -4.47 });
    expect(intersect(aOld, B)[0]).toContainEqual({ x: 19.361, y: -4.47 });
    expect(same(intersect(A, B), intersect(aOld, B))).toBe(true);
  });

  it('unionAll is not idempotent, so both frames build from parts', () => {
    // Three rects: two meeting along y = 0, and a spike crossing the join.
    // Clipper's union emits the result as two rings that touch along an edge;
    // unioning THAT output merges them into one. So growing one frame's body
    // out of the other frame's OUTPUT — which the builder never does, and
    // which the properties above therefore don't either — invents a ring-count
    // difference with no cause in the geometry.
    const parts = [rect(0, 0, 40, 40), rect(-20, -40, 60, 40), rect(-15, -10, 5, 25)];
    const body = unionAll(parts);
    expect(body.length).toBe(2);
    expect(unionAll(body).length).toBe(1);
    // Same region either way — it is purely how the engine cut it up.
    expect(same(body, unionAll(body))).toBe(true);
  });

  it('a change landing ON the overlap does report reach', () => {
    // The negative control: if this said "no reach", the test above would be
    // passing because it never makes a claim.
    const A = unionAll([rect(0, 0, 100, 100)]);
    const B = unionAll([rect(50, 0, 100, 100)]);
    const D = { x0: 40, y0: 40, x1: 80, y1: 80 }; // straddles the A∩B strip
    expect(dirtyReaches(cellsOf(D), bodyMask(A), bodyMask(B))).toBe(true);
  });

  it('a change far from both bodies reports no reach', () => {
    const A = unionAll([rect(0, 0, 100, 100)]);
    const B = unionAll([rect(50, 0, 100, 100)]);
    const D = { x0: 900, y0: 900, x1: 950, y1: 950 };
    expect(dirtyReaches(cellsOf(D), bodyMask(A), bodyMask(B))).toBe(false);
  });

  it('a change inside ONE body but clear of the overlap reports no reach', () => {
    // This is the case that pays on a real map: a line dirtied at one station
    // keeps its crossings with every line it meets somewhere else.
    const A = unionAll([rect(0, 0, 400, 40)]);
    const B = unionAll([rect(350, 0, 40, 400)]); // meets A only at the right end
    const D = { x0: 0, y0: 0, x1: 60, y1: 40 }; // far-left, inside A, clear of B
    expect(dirtyReaches(cellsOf(D), bodyMask(A), bodyMask(B))).toBe(false);
  });
});

describe('bodyMask — caching', () => {
  it('memoizes per ring-array identity', () => {
    const A = unionAll([rect(0, 0, 50, 50)]);
    expect(bodyMask(A)).toBe(bodyMask(A));
    // A value-identical but distinct array is a different entry, and must
    // still produce an equal mask.
    const copy = A.map((r) => r.map((p) => ({ ...p })));
    expect(bodyMask(copy)).not.toBe(bodyMask(A));
    expect([...bodyMask(copy)].sort()).toEqual([...bodyMask(A)].sort());
  });

  it('degenerate rings are skipped, not fatal', () => {
    // An empty or sub-triangular ring bounds no area. Before the guard these
    // left minY/maxY at +/-Infinity and the fill sized its bucket array from
    // that, throwing RangeError deep inside a drag frame.
    expect(() => bodyMask([[]])).not.toThrow();
    expect(bodyMask([[]]).size).toBe(0);
    expect(() => bodyMask([[{ x: 1, y: 2 }]])).not.toThrow();
    expect(() =>
      bodyMask([
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ]),
    ).not.toThrow();
    // A degenerate ring alongside a real one leaves the real one's mask intact.
    const real = unionAll([rect(0, 0, 40, 40)]);
    const withJunk: Ring[] = [[], ...real];
    expect([...bodyMask(withJunk)].sort()).toEqual([...bodyMask(real)].sort());
  });

  it('an empty body has an empty mask and meets nothing', () => {
    expect(bodyMask([]).size).toBe(0);
    expect(masksMeet(bodyMask([]), bodyMask(unionAll([rect(0, 0, 10, 10)])))).toBe(false);
  });

  it('MASK_CELL is coarser than a painted line but finer than the map', () => {
    expect(MASK_CELL).toBeGreaterThan(16);
    expect(MASK_CELL).toBeLessThan(200);
  });
});
