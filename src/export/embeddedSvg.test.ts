import { describe, it, expect } from 'vitest';
import { fromBase64, decodeEmbeddedSvgImage, setEmbeddedImageHref, XLINK_NS } from './embeddedSvg';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INNER = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';

const makeImage = (attrs: { href?: string; xlink?: string; width?: string }): Element => {
  const image = document.createElementNS(SVG_NS, 'image');
  if (attrs.href !== undefined) image.setAttribute('href', attrs.href);
  if (attrs.xlink !== undefined) image.setAttributeNS(XLINK_NS, 'href', attrs.xlink);
  if (attrs.width !== undefined) image.setAttribute('width', attrs.width);
  return image;
};

describe('fromBase64', () => {
  it('decodes UTF-8 bytes, not Latin-1 (bare atob would mojibake)', () => {
    // "café" in UTF-8 is 63 61 66 C3 A9 → base64 "Y2Fmw6k=". A plain atob would
    // read the C3 A9 as two Latin-1 chars ("Ã©"); fromBase64 must yield "café".
    expect(fromBase64('Y2Fmw6k=')).toBe('café');
  });
});

describe('decodeEmbeddedSvgImage', () => {
  it('decodes a base64 data:image/svg+xml href', () => {
    const image = makeImage({ href: `data:image/svg+xml;base64,${btoa(INNER)}` });
    expect(decodeEmbeddedSvgImage(image)).toBe(INNER);
  });

  it('decodes a URL-encoded data:image/svg+xml href', () => {
    const image = makeImage({ href: `data:image/svg+xml,${encodeURIComponent(INNER)}` });
    expect(decodeEmbeddedSvgImage(image)).toBe(INNER);
  });

  it('falls back to xlink:href when there is no plain href', () => {
    const image = makeImage({ xlink: `data:image/svg+xml;base64,${btoa(INNER)}` });
    expect(decodeEmbeddedSvgImage(image)).toBe(INNER);
  });

  it('returns null for a raster (non-svg) data URI', () => {
    expect(decodeEmbeddedSvgImage(makeImage({ href: 'data:image/png;base64,AAAA' }))).toBeNull();
  });

  it('returns null for an external (http) href', () => {
    expect(decodeEmbeddedSvgImage(makeImage({ href: 'https://x/y.svg' }))).toBeNull();
  });

  it('returns null for an image with no href at all', () => {
    expect(decodeEmbeddedSvgImage(makeImage({ width: '4' }))).toBeNull();
  });

  it('returns null for a malformed data URI with no comma/payload', () => {
    expect(decodeEmbeddedSvgImage(makeImage({ href: 'data:image/svg+xml' }))).toBeNull();
  });

  it('returns null for a payload that is not valid percent-encoding', () => {
    // A hand-written href carrying a literal `%` (here in `width='100%'`) is not
    // decodable percent-encoding. It must read as "not an embedded SVG we can
    // work with" — the passes skip that one image and the export goes on.
    const image = makeImage({
      href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100%'></svg>",
    });
    expect(decodeEmbeddedSvgImage(image)).toBeNull();
  });

  it('returns null for a base64 payload that is not valid base64', () => {
    const image = makeImage({ href: 'data:image/svg+xml;base64,not!valid!base64' });
    expect(decodeEmbeddedSvgImage(image)).toBeNull();
  });
});

// Read each href channel precisely: getAttributeNS(null, 'href') is the genuine
// no-namespace attribute, distinct from the xlink one. (Plain getAttribute
// ('href') matches by localName in jsdom, so it can't tell the two apart.)
const plainHref = (image: Element) => image.getAttributeNS(null, 'href');
const xlinkHref = (image: Element) => image.getAttributeNS(XLINK_NS, 'href');

describe('setEmbeddedImageHref', () => {
  it('rewrites a plain href and does not add an xlink:href', () => {
    const image = makeImage({ href: 'old' });
    setEmbeddedImageHref(image, 'new');
    expect(plainHref(image)).toBe('new');
    expect(xlinkHref(image)).toBeNull();
  });

  it('rewrites an xlink:href and does not add a plain href', () => {
    const image = makeImage({ xlink: 'old' });
    setEmbeddedImageHref(image, 'new');
    expect(xlinkHref(image)).toBe('new');
    expect(plainHref(image)).toBeNull();
  });

  it('rewrites both attributes when the image carries both', () => {
    const image = makeImage({ href: 'old', xlink: 'old' });
    setEmbeddedImageHref(image, 'new');
    expect(plainHref(image)).toBe('new');
    expect(xlinkHref(image)).toBe('new');
  });

  it('leaves an image with neither href channel untouched', () => {
    const image = makeImage({ width: '4' });
    setEmbeddedImageHref(image, 'new');
    expect(plainHref(image)).toBeNull();
    expect(xlinkHref(image)).toBeNull();
  });
});
