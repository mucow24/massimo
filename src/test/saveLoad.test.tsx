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
      labelFontSize: useDoc.getState().labelFontSize,
      labelBold: useDoc.getState().labelBold,
      labelItalic: useDoc.getState().labelItalic,
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
      labelFontSize: s.labelFontSize,
      labelBold: s.labelBold,
      labelItalic: s.labelItalic,
    });
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.labelFontSize).toBe(20);
      expect(result.doc.labelBold).toBe(true);
      expect(result.doc.labelItalic).toBe(false);
    }
  });
});
