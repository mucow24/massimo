import { describe, expect, it } from 'vitest';
import { makeDoc, makeGuide } from '../test/fixtures';
import { parse, sanitizeGuides, serialize } from './serialize';
import type { MapDoc } from './types';

function roundTrip(doc: MapDoc): MapDoc {
  const parsed = parse(serialize(doc));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
}

describe('alignment guides on the load path', () => {
  it('round-trips guides, lock included', () => {
    const doc = makeDoc({
      guides: [
        makeGuide({ id: 'g1', orientation: 'horizontal', offset: 120 }),
        makeGuide({ id: 'g2', orientation: 'vertical', offset: -35.5, locked: true }),
      ],
    });
    expect(roundTrip(doc).guides).toEqual(doc.guides);
  });

  it('round-trips diagonal guides', () => {
    const doc = makeDoc({
      guides: [
        makeGuide({ id: 'g1', orientation: 'diagonal-up', offset: 80 }),
        makeGuide({ id: 'g2', orientation: 'diagonal-down', offset: -12.5, locked: true }),
      ],
    });
    expect(roundTrip(doc).guides).toEqual(doc.guides);
  });

  it('backfills guides to {} for saves that predate the field', () => {
    const file = JSON.parse(serialize(makeDoc({})));
    delete file.doc.guides;
    const parsed = parse(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.guides).toEqual({});
  });

  it('refuses a file whose guides field is not a keyed record', () => {
    const file = JSON.parse(serialize(makeDoc({})));
    file.doc.guides = [1, 2, 3];
    const parsed = parse(JSON.stringify(file));
    expect(parsed.ok).toBe(false);
  });

  it('sanitizeGuides drops malformed entries and collapses locked:false', () => {
    const { guides, changed } = sanitizeGuides({
      ok: { id: 'ok', orientation: 'horizontal', offset: 10 },
      badOffset: { id: 'badOffset', orientation: 'vertical', offset: NaN },
      badOrient: {
        id: 'badOrient',
        orientation: 'diagonal' as unknown as 'horizontal',
        offset: 0,
      },
      storedFalse: { id: 'storedFalse', orientation: 'vertical', offset: 5, locked: false },
    });
    expect(changed).toBe(true);
    expect(Object.keys(guides).sort()).toEqual(['ok', 'storedFalse']);
    expect('locked' in guides.storedFalse).toBe(false);
  });

  it('sanitizeGuides is an identity (same reference) on a well-formed record', () => {
    const guides = {
      g1: { id: 'g1', orientation: 'horizontal' as const, offset: 10, locked: true },
    };
    const out = sanitizeGuides(guides);
    expect(out.changed).toBe(false);
    expect(out.guides).toBe(guides);
  });

  it('parse drops a malformed guide instead of refusing the file', () => {
    const file = JSON.parse(serialize(makeDoc({ guides: [makeGuide({ id: 'g1', offset: 10 })] })));
    file.doc.guides.bad = { id: 'bad', orientation: 'horizontal', offset: 'ten' };
    const parsed = parse(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.guides.g1).toBeDefined();
      expect(parsed.doc.guides.bad).toBeUndefined();
    }
  });
});
