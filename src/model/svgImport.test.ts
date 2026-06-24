import { describe, it, expect } from 'vitest';
import { parseSvgIntrinsicSize, svgTextToDataUri } from './svgImport';

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
