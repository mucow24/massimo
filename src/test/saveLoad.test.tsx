import { describe, it, expect, beforeEach } from 'vitest';
import { pickDocSnapshot, useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { parse, serialize, SCHEMA_FORMAT } from '../model/serialize';
import { makeDoc, makeLine, makeStation, makeStop, makeTransfer } from './fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

// A persisted file's canonical envelope wrapping a *sparse* doc (the shape an
// older save had before a given field existed). `docOverrides` fills in the
// non-empty parts a specific legacy case needs (e.g. some `lines`). Centralized
// so adding a persisted field is a one-place change, not a sweep over every
// legacy-parse test's hand-copied object.
function legacyEnvelope(docOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: SCHEMA_FORMAT,
    doc: {
      stations: {},
      lines: {},
      lineOrder: [],
      curveRadius: 24,
      lineCounter: 0,
      lineTags: {},
      routeBullets: {},
      transfers: {},
      ...docOverrides,
    },
  });
}

describe('save/load round-trip', () => {
  it('serialized doc parses back to the same data', () => {
    const fixture = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          name: 'Foo',
          x: 1,
          y: 2,
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1', service: 'A', color: '#0039A6', stations: ['s1'] })],
      lineOrder: ['L1'],
    });
    useDoc.setState({ ...useDoc.getState(), ...fixture });
    // Serialize the same way Toolbar onSave does — via the DOC_FIELDS-driven
    // pickDocSnapshot — so this can't drift from the real save path or omit a
    // newly-added persisted field.
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.stations).toEqual(fixture.stations);
      expect(result.doc.lines).toEqual(fixture.lines);
    }
  });

  it('save path (pickDocSnapshot) round-trips the map name', () => {
    // Mirror Toolbar.tsx onSave exactly: serialize(pickDocSnapshot(state)). If
    // `name` isn't part of DOC_FIELDS, pickDocSnapshot drops it, the serialized
    // doc has no name, and parse() fills the 'Untitled map' default instead of
    // the custom name — so this guards the DOC_FIELDS wiring.
    useDoc.setState({ ...useDoc.getState(), name: 'North Shore Line' });
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.name).toBe('North Shore Line');
    }
  });

  it('legacy files (no name field) parse with the "Untitled map" default', () => {
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.name).toBe('Untitled map');
    }
  });

  it('rejects malformed JSON without throwing', () => {
    expect(() => parse('garbage{')).not.toThrow();
    const r = parse('garbage{');
    expect(r.ok).toBe(false);
  });

  it('round-trip envelope matches the canonical format', () => {
    const json = serialize(makeDoc({}));
    const obj = JSON.parse(json);
    expect(obj.format).toBe(SCHEMA_FORMAT);
    expect(obj.doc).toBeDefined();
  });

  it('round-trips labelFontSize / labelWeight / labelItalic', () => {
    const fixture = makeDoc({
      labelFontSize: 18,
      labelWeight: 700,
      labelItalic: true,
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(18);
      expect(result.doc.labelWeight).toBe(700);
      expect(result.doc.labelItalic).toBe(true);
    }
  });

  it('parses legacy files (without label settings) by filling in defaults', () => {
    // A file saved before label settings existed: only the canonical envelope
    // and a sparse doc. Parser should merge with DEFAULT_DOC so missing
    // fields fall back to defaults.
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(12);
      expect(result.doc.labelWeight).toBe(400);
      expect(result.doc.labelItalic).toBe(false);
      // Pre-textLabels saves default to empty.
      expect(result.doc.textLabels).toEqual({});
    }
  });

  it('round-trips textLabels with all properties intact', () => {
    const fixture = makeDoc({
      textLabels: [
        {
          id: 'g1',
          x: 12,
          y: 34,
          rotation: 3,
          text: 'Riverdale\nNorth',
          fontSize: 28,
          weight: 700,
          italic: true,
          align: 'center',
          color: '#ff0000',
          darkColor: '#00ff00',
        },
      ],
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.textLabels.g1).toEqual(fixture.textLabels.g1);
    }
  });

  it('Toolbar onSave path round-trips label settings', () => {
    // Mirror Toolbar.tsx onSave exactly: serialize(pickDocSnapshot(state)).
    // Using the same DOC_FIELDS-driven snapshot the production path uses means
    // this guard cannot silently omit a newly-added persisted MapDoc field.
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 20,
      labelWeight: 700,
      labelItalic: false,
      // Non-default leading/tracking (defaults are 1 / 0) so a DOC_FIELDS
      // regression that dropped either field surfaces as a lost value here
      // rather than passing silently at the neutral default.
      labelLeading: 1.4,
      labelTracking: 0.08,
    });
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(20);
      expect(result.doc.labelWeight).toBe(700);
      expect(result.doc.labelItalic).toBe(false);
      expect(result.doc.labelLeading).toBe(1.4);
      expect(result.doc.labelTracking).toBe(0.08);
    }
  });

  it('round-trips activePalettes', () => {
    const fixture = makeDoc({ activePalettes: ['mta', 'caltrain'] });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.activePalettes).toEqual(['mta', 'caltrain']);
    }
  });

  it('round-trips per-transfer style overrides', () => {
    const fixture = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({
          id: 'x1',
          thickness: 7,
          color: { day: '#abcdef', night: '#334455' },
          strokeWidth: 3,
          strokeColor: { day: '#123456', night: '#654321' },
        }),
      ],
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.transfers.x1).toMatchObject({
        thickness: 7,
        color: { day: '#abcdef', night: '#334455' },
        strokeWidth: 3,
        strokeColor: { day: '#123456', night: '#654321' },
      });
    }
  });

  it('legacy files (no activePalettes) parse with [mta] from DEFAULT_DOC', () => {
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.activePalettes).toEqual(['mta']);
    }
  });

  it('parse normalises an explicit empty activePalettes to [mta]', () => {
    const malformed = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: { ...makeDoc({}), activePalettes: [] },
    });
    const result = parse(malformed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.activePalettes).toEqual(['mta']);
    }
  });

  it('backfills line.name for legacy files (no name field) with "${service} line"', () => {
    const legacy = legacyEnvelope({
      lines: {
        L1: { id: 'L1', service: 'A', color: '#0039A6', stations: [] },
        L2: { id: 'L2', service: 'M15', color: '#FF6319', stations: [] },
      },
      lineOrder: ['L1', 'L2'],
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.name).toBe('A line');
      expect(result.doc.lines.L2.name).toBe('M15 line');
    }
  });

  it('preserves a custom line.name on load (does not overwrite)', () => {
    const fixture = legacyEnvelope({
      lines: {
        L1: {
          id: 'L1',
          service: 'A',
          name: 'Eighth Avenue Express',
          color: '#0039A6',
          stations: [],
        },
      },
      lineOrder: ['L1'],
    });
    const result = parse(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.name).toBe('Eighth Avenue Express');
    }
  });

  it('parse normalises activePalettes containing only unknown ids to [mta]', () => {
    const malformed = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: { ...makeDoc({}), activePalettes: ['nope', 'still-nope'] },
    });
    const result = parse(malformed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.activePalettes).toEqual(['mta']);
    }
  });

  it('load heals dangling and zero-valued segmentLayers entries (not just segmentStyles)', () => {
    // A persisted line carrying an orphaned layer override (a pair-key that
    // isn't an adjacency on the line) and a zero layer (the never-stored
    // default). The load sanitizer must drop both — it previously healed
    // segmentStyles only, so a dangling segmentLayers key survived a round-trip.
    const fixture = makeDoc({
      stations: [makeStation({ id: 'a' }), makeStation({ id: 'b' })],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    fixture.lines.L1 = {
      ...fixture.lines.L1,
      segmentLayers: { 'a|zzz': 2, 'a|b': 0 }, // orphan key + zero default
    };
    const result = parse(JSON.stringify({ format: SCHEMA_FORMAT, doc: fixture }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.segmentLayers ?? {}).toEqual({});
    }
  });
});

describe('addLine auto-cycle across palettes', () => {
  it('cycles through every active palette’s colors in PALETTES order, then wraps', () => {
    // Note: BART precedes MTA alphabetically within North America, so the
    // concatenated cycle puts BART's 5 colors first, then MTA's 11.
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, activePalettes: ['bart', 'mta'] });
    const expected = [
      // BART, in order:
      '#FFE800',
      '#00AEEF',
      '#4DB848',
      '#ED1C24',
      '#FAA61A',
      // MTA, in order:
      '#0039A6',
      '#FF6319',
      '#6CBE45',
      '#A7A9AC',
      '#996633',
      '#FCCC0A',
      '#EE352E',
      '#00933C',
      '#B933AD',
      '#00ADD0',
      '#808183',
    ];
    const colors: string[] = [];
    for (let i = 0; i < 17; i++) {
      const id = useDoc.getState().addLine();
      colors.push(useDoc.getState().lines[id].color);
    }
    expect(colors.slice(0, 16)).toEqual(expected);
    // 17th wraps back to BART[0].
    expect(colors[16]).toBe(expected[0]);
  });
});
