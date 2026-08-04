import { describe, it, expect } from 'vitest';
import { parse, bakeLegacyBackgroundOrder, SCHEMA_FORMAT } from './serialize';

// The retired `polygonOrder` / `svgImageOrder` pair merges into the single
// `backgroundOrder` on load. Polygons concatenate BEFORE images, which is
// exactly what the two separate arrays painted (every image above every
// polygon) — so a legacy map's stacking survives the retirement untouched.

const legacyFile = (doc: Record<string, unknown>) =>
  JSON.stringify({
    format: SCHEMA_FORMAT,
    doc: { stations: {}, lines: {}, lineOrder: [], ...doc },
  });

const poly = (id: string) => ({
  id,
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
  fill: '#ffffff',
  stroke: '#000000',
  darkFill: '#ffffff',
  darkStroke: '#000000',
  strokeWidth: 1,
});
// A real inline data URI, not a placeholder string: an href outside the
// allowlist is DROPPED on load (sanitizeImageHrefs), which would take the
// image out of the very order under test.
const img = (id: string) => ({
  id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  href: 'data:image/svg+xml;base64,PHN2Zy8+',
});

describe('parse — legacy polygonOrder/svgImageOrder → backgroundOrder', () => {
  it('concatenates the two legacy orders, polygons first, and drops the retired keys', () => {
    const result = parse(
      legacyFile({
        polygons: { p0: poly('p0'), p1: poly('p1') },
        polygonOrder: ['p1', 'p0'],
        svgImages: { i0: img('i0'), i1: img('i1') },
        svgImageOrder: ['i1', 'i0'],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Each legacy array's own order is preserved; images land above polygons.
    expect(result.doc.backgroundOrder).toEqual(['p1', 'p0', 'i1', 'i0']);
    expect(result.doc).not.toHaveProperty('polygonOrder');
    expect(result.doc).not.toHaveProperty('svgImageOrder');
  });

  it('reconciles each legacy side: stale ids dropped, unlisted records appended', () => {
    const result = parse(
      legacyFile({
        polygons: { p0: poly('p0'), p1: poly('p1') },
        polygonOrder: ['gone', 'p1'], // p0 unlisted, 'gone' dead
        svgImages: { i0: img('i0') },
        svgImageOrder: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.backgroundOrder).toEqual(['p1', 'p0', 'i0']);
  });

  it('handles a legacy file carrying only one of the two orders', () => {
    const result = parse(
      legacyFile({ polygons: { p0: poly('p0') }, polygonOrder: ['p0'], svgImages: {} }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.backgroundOrder).toEqual(['p0']);
  });
});

describe('bakeLegacyBackgroundOrder', () => {
  it('returns the input reference when there is nothing to merge', () => {
    // migrateDoc pins pass-through-by-reference for an already-canonical doc.
    const doc = { polygons: {}, svgImages: {}, backgroundOrder: ['p0'] };
    expect(bakeLegacyBackgroundOrder(doc)).toBe(doc);
  });

  it('keeps an explicit backgroundOrder and only drops stale legacy keys', () => {
    const out = bakeLegacyBackgroundOrder({
      polygons: { p0: {} },
      svgImages: { i0: {} },
      backgroundOrder: ['i0', 'p0'],
      polygonOrder: ['p0'],
      svgImageOrder: ['i0'],
    } as Record<string, unknown>);
    expect(out.backgroundOrder).toEqual(['i0', 'p0']);
    expect(out).not.toHaveProperty('polygonOrder');
    expect(out).not.toHaveProperty('svgImageOrder');
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = bakeLegacyBackgroundOrder({
      polygons: { p0: {} },
      svgImages: { i0: {} },
      polygonOrder: ['p0'],
      svgImageOrder: ['i0'],
    } as Record<string, unknown>);
    expect(once.backgroundOrder).toEqual(['p0', 'i0']);
    expect(bakeLegacyBackgroundOrder(once)).toBe(once);
  });
});
