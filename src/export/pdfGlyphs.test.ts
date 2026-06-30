import { describe, it, expect } from 'vitest';
import type * as opentype from 'opentype.js';
import { needsGlyphOutlining, symbolFontFor } from './pdfGlyphs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an <svg> whose `<text>` children carry the given strings. */
function svgWithTexts(...texts: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const s of texts) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.textContent = s;
    svg.appendChild(t);
  }
  return svg as SVGSVGElement;
}

describe('needsGlyphOutlining', () => {
  it('is false for text fully inside Latin-1 (which HN covers)', () => {
    expect(needsGlyphOutlining(svgWithTexts('Hello World'))).toBe(false);
    expect(needsGlyphOutlining(svgWithTexts('Café ¢ ©'))).toBe(false); // all ≤ U+00FF
    expect(needsGlyphOutlining(svgWithTexts())).toBe(false);
    expect(needsGlyphOutlining(svgWithTexts(''))).toBe(false);
  });

  it('is true when any run has a character above Latin-1', () => {
    expect(needsGlyphOutlining(svgWithTexts('Go ✈'))).toBe(true); // U+2708
    expect(needsGlyphOutlining(svgWithTexts('A', 'B', 'C ↔'))).toBe(true); // any text node
  });

  it('is true for astral characters (their surrogate code units exceed 0xFF)', () => {
    expect(needsGlyphOutlining(svgWithTexts('\u{1F858}'))).toBe(true);
  });
});

describe('symbolFontFor', () => {
  // Minimal opentype.Font stand-in: only charToGlyphIndex is consulted.
  const fontCovering = (...cps: number[]) =>
    ({
      charToGlyphIndex: (ch: string) => (cps.includes(ch.codePointAt(0) ?? -1) ? 7 : 0),
    }) as unknown as opentype.Font;
  const PLANE = 0x2708;
  const ARROW = 0x2194;

  it('returns the first font in order that covers the codepoint', () => {
    const a = fontCovering(0x41); // 'A' only
    const b = fontCovering(PLANE);
    expect(symbolFontFor([a, b], PLANE)).toBe(b);
    expect(symbolFontFor([b, a], 0x41)).toBe(a);
  });

  it('prefers the earlier font when more than one covers it', () => {
    const first = fontCovering(ARROW);
    const second = fontCovering(ARROW);
    expect(symbolFontFor([first, second], ARROW)).toBe(first);
  });

  it('returns null when no font covers the codepoint', () => {
    expect(symbolFontFor([fontCovering(0x41), fontCovering(PLANE)], ARROW)).toBeNull();
    expect(symbolFontFor([], PLANE)).toBeNull();
  });
});
