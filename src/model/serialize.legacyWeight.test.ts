import { describe, it, expect } from 'vitest';
import { bakeLegacyUltraLightWeight } from './serialize';
import type { StyleDef } from './types';

/**
 * Söhne's ladder starts at 200, so the UltraLight rung (100) retired with it.
 * Every load boundary validates through `isLabelWeight`, which no longer accepts
 * 100 — so without this fold a stored UltraLight would miss the guard and drop
 * to the 400 default, jumping an UltraLight label to Roman instead of to its
 * neighbour Thin.
 */
describe('bakeLegacyUltraLightWeight', () => {
  const station = (weight?: number) => ({ id: 's1', weight }) as unknown as never;
  const label = (weight: number) => ({ id: 't1', weight }) as unknown as never;
  const style = (kind: string, weight: number): StyleDef =>
    ({ id: 'x', name: 'N', kind, props: { weight, italic: false } }) as unknown as StyleDef;

  it('folds a station weight of 100 onto Thin (200)', () => {
    const out = bakeLegacyUltraLightWeight({ stations: { s1: station(100) } });
    expect(out.stations!.s1).toMatchObject({ weight: 200 });
  });

  it('folds a text label weight of 100 onto Thin (200)', () => {
    const out = bakeLegacyUltraLightWeight({ textLabels: { t1: label(100) } });
    expect(out.textLabels!.t1).toMatchObject({ weight: 200 });
  });

  it('folds style props too, so a style and its wearers move together', () => {
    // A station tagged with an UltraLight style must not be left wearing a
    // weight its style no longer carries — that would break "tagged ⇒ matches".
    const out = bakeLegacyUltraLightWeight({
      stations: { s1: station(100) },
      styles: { x: style('station', 100) },
    });
    expect((out.styles!.x.props as { weight: number }).weight).toBe(200);
    expect(out.stations!.s1).toMatchObject({ weight: 200 });
  });

  it('leaves every other weight untouched', () => {
    const out = bakeLegacyUltraLightWeight({
      stations: { a: station(200), b: station(400), c: station(900) },
    });
    expect(Object.values(out.stations!).map((s) => (s as { weight: number }).weight)).toEqual([
      200, 400, 900,
    ]);
  });

  it('is idempotent and returns BY REFERENCE when nothing stores 100', () => {
    // Cheap enough to run unconditionally on every load, which is why it is
    // keyed off the legacy value rather than a version gate.
    const doc = { stations: { s1: station(400) }, textLabels: {}, styles: {} };
    expect(bakeLegacyUltraLightWeight(doc)).toBe(doc);
    const once = bakeLegacyUltraLightWeight({ stations: { s1: station(100) } });
    expect(bakeLegacyUltraLightWeight(once)).toBe(once);
  });

  it('tolerates a doc missing the collections entirely', () => {
    expect(() => bakeLegacyUltraLightWeight({})).not.toThrow();
  });

  it('leaves a station with no stored weight alone (it inherits the default)', () => {
    const doc = { stations: { s1: station(undefined) } };
    expect(bakeLegacyUltraLightWeight(doc)).toBe(doc);
  });
});
