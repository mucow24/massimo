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

  it('orients a MID-line station to the bisector of its two neighbours', () => {
    // Station inserted between a NEAR prev to the west and a FAR next to the
    // south: incoming travel is east, outgoing is south. Because the legs have
    // very different lengths, the bisector is only SE (→ rotation 7) if each
    // leg is normalized to a UNIT vector first; summing the raw vectors would
    // let the long south leg dominate and settle it to south (rotation 0).
    // Exercises the prev&&next branch that end-of-line insertion never reaches.
    const a = makeStation({ id: 'a', x: -10, y: 0, stops: [makeStop('L1')] });
    const m = makeStation({ id: 'm', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 1000, stops: [makeStop('L1')] });
    const out = autoOrientNewStation(dictOf(a, m, b), ['a', 'm', 'b'], 'm');
    expect(out.m.rotation).toBe(7);
  });

  it('is a no-op when the two neighbours cancel to a zero bisector', () => {
    // A line that doubles back on itself: prev and next sit on the SAME side,
    // so the incoming (1,0) and outgoing (-1,0) unit vectors sum to (0,0).
    // With no defined tangent the station keeps its rotation (dict unchanged).
    const a = makeStation({ id: 'a', x: -100, y: 0, stops: [makeStop('L1')] });
    const m = makeStation({ id: 'm', x: 0, y: 0, rotation: 5, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: -100, y: 0, stops: [makeStop('L1')] });
    const dict = dictOf(a, m, b);
    expect(autoOrientNewStation(dict, ['a', 'm', 'b'], 'm')).toBe(dict);
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

  it('flips a NORTH-travelling tangent so the label stays right-side-up', () => {
    // a below, b above; b is the just-added station, so the tangent points
    // NORTH (up the screen). The raw tangent rotation is 4 (180°), which would
    // render b's label upside down. The travel axis is the same as a
    // south-going line, so b settles at 0 (upright) instead.
    const a = makeStation({ id: 'a', x: 0, y: 100, rotation: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, rotation: 3, stops: [makeStop('L1')] });
    const out = autoOrientNewStation(dictOf(a, b), ['a', 'b'], 'b');
    expect(out.b.rotation).toBe(0); // NOT 4 (upside down)
  });

  it('flips an upside-down bisector to its right-side-up opposite', () => {
    // Splice geometry: prev to the west, next far to the NORTH, so the bisector
    // points NE and the raw tangent rotation is 5 (225°, upside-down band). The
    // axis-equivalent rotation 1 (45°) reads right-side-up.
    const a = makeStation({ id: 'a', x: -10, y: 0, stops: [makeStop('L1')] });
    const m = makeStation({ id: 'm', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: -1000, stops: [makeStop('L1')] });
    const out = autoOrientNewStation(dictOf(a, m, b), ['a', 'm', 'b'], 'm');
    expect(out.m.rotation).toBe(1); // NOT 5 (upside down)
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
