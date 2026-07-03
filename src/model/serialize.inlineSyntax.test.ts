import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT, SCHEMA_VERSION } from './serialize';
import { makeDoc, makeStation, makeTextLabel } from '../test/fixtures';

// A hand-built legacy file (no `version` field = version 1): saved under the
// old grammar where `<X>` was the circle bullet and parens were plain text.
const legacyFile = (stationName: string, labelText: string) =>
  JSON.stringify({
    format: SCHEMA_FORMAT,
    doc: {
      stations: {
        s1: {
          id: 's1',
          name: stationName,
          x: 0,
          y: 0,
          rotation: 0,
          stops: [],
          label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {},
      lineOrder: [],
      textLabels: {
        g1: {
          id: 'g1',
          x: 10,
          y: 20,
          rotation: 0,
          text: labelText,
          fontSize: 16,
          weight: 400,
          italic: false,
          align: 'left',
          color: '#111111',
          darkColor: '#ffffff',
        },
      },
    },
  });

describe('inline bullet syntax migration (file version < 2)', () => {
  it('rewrites legacy angle tokens and escapes literal pipe text', () => {
    const result = parse(legacyFile('<A> Station |lit|', 'Take <B> or <<C>>'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].name).toBe('|A| Station \\|lit|');
    expect(result.doc.textLabels['g1'].text).toBe('Take |B| or ||C||');
  });

  it('leaves version-2 files untouched (angle text is intentional there)', () => {
    const raw = JSON.parse(legacyFile('<b> is literal', 'bullet |A|'));
    raw.version = 2;
    const result = parse(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].name).toBe('<b> is literal');
    expect(result.doc.textLabels['g1'].text).toBe('bullet |A|');
  });

  it('serialize stamps the current schema version so round-trips never rewrite', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', name: 'angle <keep> and bullet |A|' })],
      textLabels: [makeTextLabel({ id: 'g1', text: 'tags <b>stay</b>' })],
    });
    const json = serialize(doc);
    expect(JSON.parse(json).version).toBe(SCHEMA_VERSION);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].name).toBe('angle <keep> and bullet |A|');
    expect(result.doc.textLabels['g1'].text).toBe('tags <b>stay</b>');
  });
});
