import { describe, it, expect } from 'vitest';
import { parse, SCHEMA_FORMAT } from '../model/serialize';
import { migrateDoc } from '../state/store';
import { updateStyleProps } from '../model/styles';
import { resolveDotStyle } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

// A PRE-STYLES-ERA save: no `styles` / `styleDefaults` key at all, and the line
// carries the pre-v7 legacy `defaultDotShape: 'filled-white'` preset id.
function legacyFileDoc(): Record<string, unknown> {
  const {
    styles: _s,
    styleDefaults: _sd,
    ...noStyles
  } = makeDoc({
    stations: [makeStation({ id: 's1', stops: [makeStop('l1')] })],
    lines: [makeLine({ id: 'l1' })],
  }) as MapDoc;
  const raw = structuredClone(noStyles) as Record<string, unknown>;
  const lines = raw.lines as Record<string, Record<string, unknown>>;
  // Legacy shape: the retired single preset id, no split fields, no tags.
  delete lines.l1.singletonDotStyle;
  delete lines.l1.multiDotStyle;
  delete lines.l1.singletonDotStyleId;
  delete lines.l1.multiDotStyleId;
  lines.l1.defaultDotShape = 'filled-white';
  return raw;
}

const parsed = (): MapDoc => {
  const res = parse(JSON.stringify({ format: SCHEMA_FORMAT, version: 1, doc: legacyFileDoc() }));
  if (!res.ok) throw new Error(res.error);
  return res.doc;
};

describe('parse() must run the stopDot library bake on a pre-styles file', () => {
  it('tags the line dot slots and seeds the worn preset (same as the rehydrate path)', () => {
    const doc = parsed();
    const viaPersist = migrateDoc(legacyFileDoc(), 0) as unknown as MapDoc;

    // Ground truth: the localStorage path on the IDENTICAL doc tags + seeds.
    expect(viaPersist.lines.l1.singletonDotStyleId).toBe('stop-filled-white');
    expect(viaPersist.styles['stop-filled-white']).toBeDefined();

    // The file-import path must agree.
    expect(doc.lines.l1.singletonDotStyleId).toBe('stop-filled-white');
    expect(doc.lines.l1.multiDotStyleId).toBe('stop-filled-white');
    expect(doc.styles['stop-filled-white']).toBeDefined();
  });

  it('does not adopt the line into the Default line style (its dot type differs)', () => {
    const doc = parsed();
    const viaPersist = migrateDoc(legacyFileDoc(), 0) as unknown as MapDoc;
    // Rehydrate leaves it untagged — a filled-WHITE line is not the Default
    // (filled-black) line style.
    expect(viaPersist.lines.l1.styleId).toBeUndefined();
    expect(doc.lines.l1.styleId).toBeUndefined();
  });

  it('editing the Default line style width does not blacken the line’s white dots', () => {
    const doc = parsed();
    const before = resolveDotStyle(doc.lines.l1, doc.stations.s1.stops[0], true);
    expect(before.fill).toEqual({ day: '#ffffff', night: '#ffffff' });

    // Styles ▸ Line ▸ Default ▸ nudge the width.
    const next = updateStyleProps(doc, 'default-line', { width: 12 });
    const after = resolveDotStyle(next.lines.l1, next.stations.s1.stops[0], true);
    expect(after.fill).toEqual(before.fill);
  });
});
