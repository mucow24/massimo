import { describe, it, expect } from 'vitest';
import { autoOrientNewStation } from './autoOrient';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, StationId } from './types';

const dictOf = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

describe('autoOrientNewStation', () => {
  it('is a no-op when the station has no neighbour on the line yet', () => {
    // 1-station line: no tangent to orient to.
    const a = makeStation({ id: 'a', rotation: 5, stops: [makeStop('L1')] });
    const dict = dictOf(a);
    expect(autoOrientNewStation(dict, ['a'], 'a')).toBe(dict);
  });

  it('orients the new station to the line tangent (vertical → 0)', () => {
    // a above, b below; b is the just-added station. Auto-vertical local +y
    // points +y in world, so the vertical tangent settles b to rotation 0.
    const a = makeStation({ id: 'a', x: 0, y: 0, rotation: 5, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, rotation: 3, stops: [makeStop('L1')] });
    const out = autoOrientNewStation(dictOf(a, b), ['a', 'b'], 'b');
    expect(out.b.rotation).toBe(0);
  });

  it('leaves the pre-existing neighbour untouched', () => {
    // a already serves the line at a deliberate rotation; adding b must not
    // disturb a, even though a whole-line pass would have re-set it.
    const a = makeStation({ id: 'a', x: 0, y: 0, rotation: 5, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 100, y: 0, rotation: 0, stops: [makeStop('L1')] });
    const out = autoOrientNewStation(dictOf(a, b), ['a', 'b'], 'b');
    expect(out.a.rotation).toBe(5); // untouched
    expect(out.b.rotation).toBe(6); // horizontal tangent
  });

  it('settles rotation = 7 for a line travelling SE (45° diagonal)', () => {
    // (0,0) → (100,100): rotateBy({0,1}, 7) = SE in screen-y-down coords.
    const a = makeStation({
      id: 'a',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
    });
    const b = makeStation({
      id: 'b',
      x: 100,
      y: 100,
      rotation: 0,
      stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
    });
    const out = autoOrientNewStation(dictOf(a, b), ['a', 'b'], 'b');
    expect(out.b.rotation).toBe(7);
  });

  it('is idempotent', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const dict = dictOf(a, b);
    const once = autoOrientNewStation(dict, ['a', 'b'], 'b');
    const twice = autoOrientNewStation(once, ['a', 'b'], 'b');
    expect(twice).toEqual(once);
  });
});
