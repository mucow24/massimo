import { describe, it, expect, beforeEach } from 'vitest';
import { TEXT_MEASURE_CACHE_LIMIT, _clearTextMeasureCache, measureTextLabel } from './textMeasure';
import { makeTextLabel } from '../test/fixtures';

/**
 * Guard rails on TEXT_MEASURE_CACHE_LIMIT from both sides: big enough that a
 * whole map's labels stay resident, still bounded. Why undershooting it is a
 * cliff rather than a slope is written where the constant lives.
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
