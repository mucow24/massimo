import { describe, it, expect, beforeEach } from 'vitest';
import {
  TEXT_MEASURE_CACHE_LIMIT,
  _clearTextMeasureCache,
  invalidateMeasuredFaces,
  measureTextLabel,
} from './textMeasure';
import { makeTextLabel } from '../test/fixtures';
import { stubTextMetrics } from '../test/textMetrics';

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
  // A real 2D context, so measurement resolves a font DECLARATION per run —
  // which is where an entry's face set comes from. Under jsdom's absent canvas
  // the length estimate never builds one, and every entry would record no face.
  stubTextMetrics((s, px) => ({
    width: s.length * px * 0.5,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: s.length * px * 0.5,
  }));

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

  it('a late webfont drops only the labels that use the arriving face', () => {
    const light = makeTextLabel({ id: 'g', text: 'Canal St', weight: 400 });
    const bold = makeTextLabel({ id: 'g', text: 'Canal St', weight: 700 });
    const lightSeeded = measureTextLabel(light);
    const boldSeeded = measureTextLabel(bold);

    invalidateMeasuredFaces([{ family: 'Soehne', weight: '700', style: 'normal' }]);

    expect(measureTextLabel(bold)).not.toBe(boldSeeded);
    expect(measureTextLabel(light)).toBe(lightSeeded);
  });

  it('an arrival that names no face drops everything — nothing to narrow by', () => {
    const label = makeTextLabel({ id: 'g', text: 'Canal St' });
    const seeded = measureTextLabel(label);
    invalidateMeasuredFaces([]);
    expect(measureTextLabel(label)).not.toBe(seeded);
  });

  it('a face outside the text family drops everything — it can serve any run', () => {
    const label = makeTextLabel({ id: 'g', text: 'Canal St' });
    const seeded = measureTextLabel(label);
    invalidateMeasuredFaces([{ family: 'Massimo Symbols', weight: '400', style: 'normal' }]);
    expect(measureTextLabel(label)).not.toBe(seeded);
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
