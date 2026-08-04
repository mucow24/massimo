import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { isAllowedImageHref } from './svgImport';
import { migrateDoc } from '../state/store';
import { makeDoc, makeSvgImage } from '../test/fixtures';

describe('svg-image serialization', () => {
  it('round-trips a doc containing svg images and their paint order', () => {
    const doc = makeDoc({
      svgImages: [
        makeSvgImage({ id: 'i0', x: 10, y: 20, width: 80, height: 40 }),
        makeSvgImage({ id: 'i1' }),
      ],
      backgroundOrder: ['i1', 'i0'],
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
    expect(result.doc.backgroundOrder).toEqual(['i1', 'i0']);
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

  // The href guard had exactly one production caller — the clipboard paste
  // path — so a hand-edited file could carry a remote https:// href straight
  // in. SvgImageView then issued an outbound request on every paint, and the
  // href was re-serialized into library payloads and into every SVG/PNG/PDF
  // export, quietly ending the self-contained-export property.
  describe('image hrefs outside the inline-data allowlist', () => {
    const withHref = (href: string) =>
      makeDoc({ svgImages: [makeSvgImage({ id: 'i0', href })], backgroundOrder: ['i0'] });

    it('the guard itself rejects a remote href (control)', () => {
      expect(isAllowedImageHref('https://tracker.example/px.png')).toBe(false);
      expect(isAllowedImageHref('data:image/png;base64,AAAA')).toBe(true);
    });

    it('drops an image with a remote href on the FILE path', () => {
      const result = parse(serialize(withHref('https://tracker.example/px.png')));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.doc.svgImages['i0']).toBeUndefined();
      expect(result.doc.backgroundOrder).toEqual([]);
    });

    it('drops one on the REHYDRATE path too, so the two stay in step', () => {
      const doc = withHref('https://tracker.example/px.png');
      // Current store version: the repair is an invariant, not a migration
      // step, so it must run even when nothing needs migrating.
      const out = migrateDoc(
        { svgImages: doc.svgImages, backgroundOrder: doc.backgroundOrder },
        24,
      ) as unknown as { svgImages: Record<string, unknown>; backgroundOrder: string[] };
      expect(out.svgImages['i0']).toBeUndefined();
      expect(out.backgroundOrder).toEqual([]);
    });

    it('keeps an allowed inline data URI (control)', () => {
      const ok = 'data:image/png;base64,iVBORw0KGgo=';
      const result = parse(serialize(withHref(ok)));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.doc.svgImages['i0'].href).toBe(ok);
      expect(result.doc.backgroundOrder).toEqual(['i0']);
    });
  });

  it('fills svgImages/backgroundOrder to empty for a legacy file lacking them', () => {
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
    expect(result.doc.backgroundOrder).toEqual([]);
  });
});
