import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { parse, serialize, SCHEMA_FORMAT } from '../model/serialize';
import { makeDoc, makeLine, makeStation, makeStop } from './fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

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
    const json = serialize({
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineOrder: useDoc.getState().lineOrder,
      curveRadius: useDoc.getState().curveRadius,
      lineCounter: useDoc.getState().lineCounter,
      lineTags: useDoc.getState().lineTags,
      routeBullets: useDoc.getState().routeBullets,
      transfers: useDoc.getState().transfers,
      textLabels: useDoc.getState().textLabels,
      labelFontSize: useDoc.getState().labelFontSize,
      labelBold: useDoc.getState().labelBold,
      labelItalic: useDoc.getState().labelItalic,
      activePalettes: useDoc.getState().activePalettes,
    });
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.stations).toEqual(fixture.stations);
      expect(result.doc.lines).toEqual(fixture.lines);
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

  it('round-trips labelFontSize / labelBold / labelItalic', () => {
    const fixture = makeDoc({
      labelFontSize: 18,
      labelBold: true,
      labelItalic: true,
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(18);
      expect(result.doc.labelBold).toBe(true);
      expect(result.doc.labelItalic).toBe(true);
    }
  });

  it('parses legacy files (without label settings) by filling in defaults', () => {
    // A file saved before label settings existed: only the canonical envelope
    // and a sparse doc. Parser should merge with DEFAULT_DOC so missing
    // fields fall back to defaults.
    const legacy = JSON.stringify({
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
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(12);
      expect(result.doc.labelBold).toBe(false);
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
    // Mirror Toolbar.tsx onSave: reads each field off the live store and
    // hands them to serialize(). This guards against onSave forgetting a
    // newly-added MapDoc field.
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 20,
      labelBold: true,
      labelItalic: false,
    });
    const s = useDoc.getState();
    const json = serialize({
      stations: s.stations,
      lines: s.lines,
      lineOrder: s.lineOrder,
      curveRadius: s.curveRadius,
      lineCounter: s.lineCounter,
      lineTags: s.lineTags,
      routeBullets: s.routeBullets,
      transfers: s.transfers,
      textLabels: s.textLabels,
      labelFontSize: s.labelFontSize,
      labelBold: s.labelBold,
      labelItalic: s.labelItalic,
      activePalettes: s.activePalettes,
    });
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(20);
      expect(result.doc.labelBold).toBe(true);
      expect(result.doc.labelItalic).toBe(false);
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

  it('legacy files (no activePalettes) parse with [mta] from DEFAULT_DOC', () => {
    const legacy = JSON.stringify({
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
      },
    });
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
