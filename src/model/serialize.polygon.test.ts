import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { makeDoc, makePolygon } from '../test/fixtures';

describe('polygon serialization', () => {
  it('round-trips a doc containing polygons', () => {
    const doc = makeDoc({
      polygons: [makePolygon({ id: 'p0', fill: '#123456', strokeWidth: 3 })],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.polygons['p0']).toBeDefined();
    expect(result.doc.polygons['p0'].fill).toBe('#123456');
    expect(result.doc.polygons['p0'].strokeWidth).toBe(3);
    expect(result.doc.polygons['p0'].vertices).toHaveLength(4);
  });

  it('defaults polygons to {} for a legacy file saved before the field existed', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: { stations: {}, lines: {}, lineOrder: [] }, // no `polygons` key
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.polygons).toEqual({});
  });
});
