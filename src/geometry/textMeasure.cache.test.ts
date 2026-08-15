import { describe, it, expect, beforeEach } from 'vitest';
import { TEXT_MEASURE_CACHE_LIMIT, _clearTextMeasureCache, measureTextLabel } from './textMeasure';
import { makeTextLabel } from '../test/fixtures';

/**
 * The measurement cache's failure mode is a CLIFF, not a slope. Every render
 * measures every rendered label, in roughly the same order — a cyclic scan —
 * and a cyclic scan over a working set larger than the cache hits nothing at
 * all, whatever the eviction policy. So a cap set below a real drawing's label
 * count does not make measuring "a bit slower": it makes every hover, press
 * and click re-measure the whole map from scratch. Measured on a 489-station
 * drawing, the cap at 256 cost 765ms per hover and 1416ms per alt+click; over
 * the working set both fall to nothing.
 *
 * These two tests are the guard rails on that number from both sides.
 */
// Comfortably past any drawing that exists — the point is that the cache
// survives a whole map's worth of distinct labels, not that it survives
// exactly this many.
const A_WHOLE_MAP_OF_LABELS = 2000;

describe('text measurement cache', () => {
  beforeEach(() => {
    _clearTextMeasureCache();
  });

  it('still holds the first label after a whole map has been measured', () => {
    const first = makeTextLabel({ id: 'g', text: 'Station 0' });
    const seeded = measureTextLabel(first);
    for (let i = 1; i < A_WHOLE_MAP_OF_LABELS; i++) {
      measureTextLabel(makeTextLabel({ id: 'g', text: `Station ${i}` }));
    }
    // A hit hands back the very object it stored; a miss re-measures and
    // returns a fresh one, so identity is the observable.
    expect(measureTextLabel(first)).toBe(seeded);
  });

  it('is still bounded — the entry past the cap evicts the oldest', () => {
    const first = makeTextLabel({ id: 'g', text: 'over 0' });
    const seeded = measureTextLabel(first);
    for (let i = 1; i <= TEXT_MEASURE_CACHE_LIMIT; i++) {
      measureTextLabel(makeTextLabel({ id: 'g', text: `over ${i}` }));
    }
    expect(measureTextLabel(first)).not.toBe(seeded);
  });
});
