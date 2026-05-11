import { describe, it, expect } from 'vitest';
import { autoOrientLineStops } from './autoOrient';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, StationId } from './types';

const dictOf = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

describe('autoOrientLineStops', () => {
  it('is a no-op when the line has fewer than 2 stations', () => {
    const a = makeStation({ id: 'a', rotation: 5 });
    const dict = dictOf(a);
    expect(autoOrientLineStops(dict, 'L1', ['a'])).toBe(dict);
  });

  it('aligns rotation to the line tangent for a 2-station line', () => {
    // Stations on a vertical line (s1 above, s2 below). Line travels +y.
    // travelDirLocal at rotation 0 (auto-vertical) is +y, so this should
    // settle to rotation 0 for both stations.
    const s1 = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 5,
      stops: [makeStop('L1')],
    });
    const s2 = makeStation({
      id: 's2',
      x: 0,
      y: 100,
      rotation: 3,
      stops: [makeStop('L1')],
    });
    const out = autoOrientLineStops(dictOf(s1, s2), 'L1', ['s1', 's2']);
    expect(out.s1.rotation).toBe(0);
    expect(out.s2.rotation).toBe(0);
  });

  it('skips transfer stations (those carrying other lines too)', () => {
    // s1 has L1 + L2 — a transfer. Its rotation should NOT be auto-set.
    const s1 = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 5,
      stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
    });
    const s2 = makeStation({
      id: 's2',
      x: 0,
      y: 100,
      rotation: 3,
      stops: [makeStop('L1')],
    });
    const out = autoOrientLineStops(dictOf(s1, s2), 'L1', ['s1', 's2']);
    expect(out.s1.rotation).toBe(5); // unchanged
    expect(out.s2.rotation).toBe(0); // single-line, was reoriented
  });

  it('is idempotent', () => {
    const s1 = makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] });
    const s2 = makeStation({ id: 's2', x: 0, y: 100, stops: [makeStop('L1')] });
    const dict = dictOf(s1, s2);
    const once = autoOrientLineStops(dict, 'L1', ['s1', 's2']);
    const twice = autoOrientLineStops(once, 'L1', ['s1', 's2']);
    expect(twice).toEqual(once);
  });

  it('settles rotation = 7 for a line traveling SE (45° diagonal)', () => {
    // Stations on a perfect SE line: (0,0) → (100, 100). rotateBy({0,1}, 7)
    // = (√2/2, √2/2) = SE in screen-y-down. So local +y aligning with the
    // SE world tangent is rotation 7 for both stations.
    const s1 = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
    });
    const s2 = makeStation({
      id: 's2',
      x: 100,
      y: 100,
      rotation: 0,
      stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
    });
    const out = autoOrientLineStops(dictOf(s1, s2), 'L1', ['s1', 's2']);
    expect(out.s1.rotation).toBe(7);
    expect(out.s2.rotation).toBe(7);
  });
});
