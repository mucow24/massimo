import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { bodyMask, cellsOfBox, dirtyReaches, masksMeet, MASK_CELL } from './bodyMask';
import { intersect, unionAll, type Ring } from './clip';
import { ringSetKey, ringsBbox } from './lineRegions';

/**
 * The mask is only allowed to skip work that would have returned nothing. Two
 * claims carry that, and both are checked here against the clipper itself
 * rather than argued:
 *
 *   1. `!masksMeet(A, B)`  ⇒  `intersect(A, B)` is empty.
 *   2. no dirty cell in both masks (old AND new)  ⇒  the pair's intersection
 *      is byte-identical to the previous frame's.
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

/** A blob: several overlapping rectangles unioned, i.e. the same shape of
 *  input a line body is — clipper output, non-self-intersecting, possibly
 *  holed, and much wider than one cell. */
const blobArb = (cx: number, cy: number, spread: number) =>
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
    .map((parts) => unionAll(parts.map((p) => rotRect(cx + p.dx, cy + p.dy, p.w, p.h, p.rot))));

const cellsOf = (b: { x0: number; y0: number; x1: number; y1: number }) => {
  const s = new Set<number>();
  cellsOfBox(b, s);
  return s;
};

/**
 * The codebase's own notion of "the same rings": `ringSetKey`, which hashes
 * each ring from a canonical starting vertex. That canonicalization is not a
 * convenience — clipper is free to emit the same polygon rotated to a
 * different first vertex when UNRELATED input moved, which is exactly the
 * situation a reused pair result is in. A raw byte compare here reports those
 * rotations as differences; `ringSetKey` is the equivalence every region cache
 * in this codebase already keys on, so it is the one the reuse must satisfy.
 * (Found the hard way: the byte compare produced a counterexample whose
 * symmetric difference was empty and whose ring counts matched — only the
 * start vertex had moved.)
 */
const same = (a: Ring[], b: Ring[]) =>
  a.length === b.length && ringSetKey(a, ringsBbox(a)) === ringSetKey(b, ringsBbox(b));

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
        blobArb(0, 0, 150),
        blobArb(0, 0, 150),
        fc.record({
          x: fc.integer({ min: -600, max: 600 }),
          y: fc.integer({ min: -600, max: 600 }),
          w: fc.integer({ min: 8, max: 90 }),
          h: fc.integer({ min: 8, max: 90 }),
        }),
        (aOld, B, patch) => {
          if (!aOld.length || !B.length) return true;
          // A changes ONLY inside D: a rectangle is added there.
          const D = { x0: patch.x, y0: patch.y, x1: patch.x + patch.w, y1: patch.y + patch.h };
          const aNew = unionAll([...aOld, rect(patch.x, patch.y, patch.w, patch.h)]);
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
        blobArb(0, 0, 150),
        blobArb(0, 0, 150),
        fc.record({
          x: fc.integer({ min: -400, max: 400 }),
          y: fc.integer({ min: -400, max: 400 }),
          w: fc.integer({ min: 8, max: 90 }),
          h: fc.integer({ min: 8, max: 90 }),
        }),
        (aNew, B, patch) => {
          if (!aNew.length || !B.length) return true;
          const D = { x0: patch.x, y0: patch.y, x1: patch.x + patch.w, y1: patch.y + patch.h };
          // aOld carried an extra part in D that aNew no longer has.
          const aOld = unionAll([...aNew, rect(patch.x, patch.y, patch.w, patch.h)]);
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
