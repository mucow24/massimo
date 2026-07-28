import { afterAll, describe, expect, it } from 'vitest';
import { ClipType, EndType, JoinType, PolyFillType } from 'js-angusj-clipper';
import { ClipperUnavailableError, __resetClipper, loadClipper, unionAll, type Ring } from './clip';

const square = (x: number, y: number, s: number): Ring => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('clipper engine', () => {
  // clip.ts writes these as bare literals and casts them, because importing the
  // enum VALUES would pull the engine into the entry chunk. That cast throws
  // away the only compile-time check on the strings, so buy it back here: if
  // the library ever renumbers an enum, this fails instead of a fill rule
  // silently changing under every boolean in the app.
  it('the literals clip.ts casts still match the library enums', () => {
    expect(ClipType.Intersection).toBe('intersection');
    expect(ClipType.Union).toBe('union');
    expect(ClipType.Difference).toBe('difference');
    expect(PolyFillType.NonZero).toBe('nonZero');
    expect(JoinType.Round).toBe('round');
    expect(JoinType.Miter).toBe('miter');
    expect(EndType.OpenButt).toBe('openButt');
    expect(EndType.ClosedPolygon).toBe('closedPolygon');
  });

  it('reports which build it loaded, and is idempotent', async () => {
    const first = await loadClipper();
    expect(['wasm', 'asmJs']).toContain(first);
    expect(await loadClipper()).toBe(first);
  });

  // Memoizing only the RESOLVED instance leaves the load window itself
  // unguarded: callers arriving before the first resolve each compile their own
  // wasm module, and the loser's instance replaces the winner's in the slot
  // every synchronous consumer reads. Promise identity is the whole contract —
  // one shared load, not two that happen to agree — so assert exactly that
  // rather than the format, which two independent loads would also agree on.
  it('concurrent callers share one in-flight load', async () => {
    __resetClipper();
    // Deliberately un-awaited: both calls have to be in flight at once.
    const first = loadClipper();
    const second = loadClipper();
    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });

  // There is no fallback implementation any more, so using the module early has
  // to be a loud, named failure rather than a null dereference three call
  // frames into a geometry pass.
  it('throws a named error when used before it has loaded', async () => {
    __resetClipper();
    try {
      expect(() => unionAll([square(0, 0, 10)])).toThrow(ClipperUnavailableError);
      expect(() => unionAll([square(0, 0, 10)])).toThrow(/before loadClipper/);
    } finally {
      await loadClipper();
    }
  });

  afterAll(async () => {
    // Every other test file shares this module instance; leave it loaded.
    await loadClipper();
  });
});
