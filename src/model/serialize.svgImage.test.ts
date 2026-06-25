import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { makeDoc, makeSvgImage } from '../test/fixtures';

describe('svg-image serialization', () => {
  it('round-trips a doc containing svg images and their paint order', () => {
    const doc = makeDoc({
      svgImages: [
        makeSvgImage({ id: 'i0', x: 10, y: 20, width: 80, height: 40 }),
        makeSvgImage({ id: 'i1' }),
      ],
      svgImageOrder: ['i1', 'i0'],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.svgImages['i0']).toMatchObject({
      id: 'i0',
      x: 10,
      y: 20,
      width: 80,
      height: 40,
    });
    expect(result.doc.svgImageOrder).toEqual(['i1', 'i0']);
  });

  it('preserves a continuous (non-octant) rotation through a round-trip', () => {
    // SvgImage deliberately diverges from the 8-step Rotation; a value like
    // 247.5 must survive verbatim, never get snapped/normalized to an octant.
    const doc = makeDoc({ svgImages: [makeSvgImage({ id: 'i0', rotation: 247.5 })] });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.svgImages['i0'].rotation).toBe(247.5);
  });

  it('fills svgImages/svgImageOrder to empty for a legacy file lacking them', () => {
    // A pre-feature save has no svg keys at all. The DEFAULT_DOC merge in
    // parse() must default them to {} / [] rather than leaving them undefined.
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: { stations: {}, lines: {}, lineOrder: [] },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.svgImages).toEqual({});
    expect(result.doc.svgImageOrder).toEqual([]);
  });
});
