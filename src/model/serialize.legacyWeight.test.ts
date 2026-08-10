import { describe, it, expect } from 'vitest';
import { bakeLegacyUltraLightWeight, parse } from './serialize';
import type { MapDoc, StyleDef } from './types';

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

/**
 * Through the REAL file path. Testing the bake in isolation is not enough — it
 * has to run BEFORE `sanitizeStyles`, which validates style props with
 * `isLabelWeight` and drops any def still carrying the retired 100 (taking its
 * wearers' `styleId` with it). Ordering is the whole bug this guards.
 */
describe('parse() folds a legacy UltraLight through the file path', () => {
  const fileWith = (doc: unknown): string =>
    JSON.stringify({ format: 'massimo-map', version: 2, doc });
  const parsed = (doc: unknown): MapDoc => {
    const r = parse(fileWith(doc));
    if (!r.ok) throw new Error(r.error);
    return r.doc;
  };

  it('keeps a weight-100 station style def, folded to Thin, with its wearer still tagged', () => {
    const doc = parsed({
      stations: {
        // The station's EFFECTIVE typography must equal the def's props or the
        // "tagged ⇒ matches" invariant prunes the tag; fontSize 6 is carried on
        // both, leading/tracking sit at their defaults on both.
        s1: {
          id: 's1',
          name: 'A',
          x: 0,
          y: 0,
          stops: [],
          fontSize: 6,
          weight: 100,
          italic: false,
          styleId: 'st1',
        },
      },
      styles: {
        st1: {
          id: 'st1',
          name: 'Feather',
          kind: 'station',
          // A full StationStyleProps — an incomplete one is dropped by
          // sanitizeStyles for reasons unrelated to the weight.
          props: { fontSize: 6, weight: 100, italic: false, leading: 1, tracking: 0 },
        },
      },
    });
    const def = doc.styles?.st1;
    expect(def, 'the def must survive sanitizeStyles').toBeDefined();
    expect((def!.props as { weight: number }).weight).toBe(200);
    expect(doc.stations.s1.weight).toBe(200);
    expect(doc.stations.s1.styleId, 'the tag must not be pruned').toBe('st1');
  });

  it('folds the retired doc-global labelWeight instead of dropping it to Roman', () => {
    // bakeLegacyLabelSettings reads the doc-level legacy field through
    // isLabelWeight; an unfolded 100 lands on the 400 default — the exact
    // jump-to-Roman this is supposed to prevent.
    const doc = parsed({
      stations: { s1: { id: 's1', name: 'A', x: 0, y: 0, stops: [] } },
      labelWeight: 100,
    });
    expect(doc.stations.s1.weight ?? 400).toBe(200);
  });
});
