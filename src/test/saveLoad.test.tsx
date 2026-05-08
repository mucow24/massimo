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
});
