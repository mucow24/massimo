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

  it('round-trips dark colors distinct from the light colors', () => {
    const doc = makeDoc({
      polygons: [
        makePolygon({
          id: 'p0',
          fill: '#112233',
          stroke: '#445566',
          darkFill: '#778899',
          darkStroke: '#99aabb',
        }),
      ],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.doc.polygons['p0'];
    expect(p.fill).toBe('#112233');
    expect(p.stroke).toBe('#445566');
    expect(p.darkFill).toBe('#778899');
    expect(p.darkStroke).toBe('#99aabb');
  });

  it('backfills missing dark colors on load to equal the light colors', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        polygons: {
          p0: {
            id: 'p0',
            vertices: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 5, y: 8 },
            ],
            fill: '#123456',
            stroke: '#abcdef',
            strokeWidth: 1,
          },
        },
        polygonOrder: ['p0'],
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.polygons['p0'].darkFill).toBe('#123456');
    expect(result.doc.polygons['p0'].darkStroke).toBe('#abcdef');
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
