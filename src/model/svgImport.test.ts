import { describe, it, expect } from 'vitest';
import {
  bytesToDataUri,
  isAllowedImageHref,
  parseSvgIntrinsicSize,
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
