import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  bytesToDataUri,
  isAllowedImageHref,
  isImageFileTooLarge,
  MAX_IMAGE_IMPORT_BYTES,
  parseSvgIntrinsicSize,
  rasterFileToImage,
  svgTextToDataUri,
} from './svgImport';

describe('parseSvgIntrinsicSize', () => {
  it('uses the viewBox when there is no explicit width/height', () => {
    expect(parseSvgIntrinsicSize('<svg viewBox="0 0 320 240"></svg>')).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('prefers explicit width/height over the viewBox', () => {
    expect(
      parseSvgIntrinsicSize('<svg width="100" height="50" viewBox="0 0 320 240"></svg>'),
    ).toEqual({ width: 100, height: 50 });
  });

  it('ignores non-px units and falls through to the viewBox', () => {
    expect(
      parseSvgIntrinsicSize('<svg width="2cm" height="1cm" viewBox="0 0 320 240"></svg>'),
    ).toEqual({ width: 320, height: 240 });
  });

  it('falls back to 200×200 when neither width/height nor viewBox is usable', () => {
    expect(parseSvgIntrinsicSize('<svg></svg>')).toEqual({ width: 200, height: 200 });
  });
});

describe('isAllowedImageHref', () => {
  it('accepts inline svg and basic raster data URIs', () => {
    expect(isAllowedImageHref('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true);
    expect(isAllowedImageHref('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedImageHref('data:image/jpeg;base64,AAAA')).toBe(true);
  });

  it('rejects remote references and non-image data URIs', () => {
    expect(isAllowedImageHref('http://evil.example/x.png')).toBe(false);
    expect(isAllowedImageHref('https://evil.example/x.svg')).toBe(false);
    expect(isAllowedImageHref('data:text/html;base64,AAAA')).toBe(false);
    expect(isAllowedImageHref('data:image/webp;base64,AAAA')).toBe(false);
    expect(isAllowedImageHref('javascript:alert(1)')).toBe(false);
  });
});

describe('bytesToDataUri', () => {
  it('base64-encodes raw bytes under the given mime', () => {
    const uri = bytesToDataUri('image/png', new Uint8Array([137, 80, 78, 71]));
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const b64 = uri.slice('data:image/png;base64,'.length);
    const bytes = Uint8Array.from(globalThis.atob(b64), (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([137, 80, 78, 71]);
  });
});

describe('image import size ceiling', () => {
  // Every imported image rides in the doc as an inline data URI, so it is
  // carried by localStorage on every edit. Without a ceiling a phone photo
  // pushes the persisted doc past the origin quota and the map stops reaching
  // storage at all — the reason the gate is on BYTES and not just on the mime.
  const decoded = { width: 40, height: 30, close: () => {} };
  const decode = vi.fn(() => Promise.resolve(decoded));

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  const pngOf = (bytes: number): File =>
    new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' });

  it('answers for any chosen file, svg included (the svg branch has no decode step)', () => {
    const svg = new File([new Uint8Array(MAX_IMAGE_IMPORT_BYTES + 1)], 'big.svg', {
      type: 'image/svg+xml',
    });
    expect(isImageFileTooLarge(svg)).toBe(true);
    expect(isImageFileTooLarge(pngOf(1024))).toBe(false);
  });

  it('rejects an oversized raster without even decoding it', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = decode;
    expect(await rasterFileToImage(pngOf(MAX_IMAGE_IMPORT_BYTES + 1))).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('still imports a file within the ceiling', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = decode;
    const image = await rasterFileToImage(pngOf(64));
    expect(image?.width).toBe(40);
    expect(image?.href.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('svgTextToDataUri', () => {
  it('round-trips UTF-8 content (including non-Latin1 characters)', () => {
    const svg = '<svg><text>日本語 ✓</text></svg>';
    const uri = svgTextToDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const b64 = uri.slice('data:image/svg+xml;base64,'.length);
    const bytes = Uint8Array.from(globalThis.atob(b64), (c) => c.charCodeAt(0));
    expect(new globalThis.TextDecoder().decode(bytes)).toBe(svg);
  });
});
