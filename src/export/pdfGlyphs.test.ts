import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import {
  glyphPathData,
  needsGlyphOutlining,
  outlineUnsupportedText,
  symbolFontFor,
} from './pdfGlyphs';

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

describe('glyphPathData', () => {
  const build = (commands: unknown[]) => glyphPathData({ commands } as unknown as opentype.Path);

  it('keeps the separator before a coordinate that rounds to "0" (opentype toPathData drops it)', () => {
    // y = -0.003 rounds to "0"; the space before it must survive so the parser
    // does not fuse "-1.55" and "0" into the malformed number "-1.550".
    expect(
      build([
        { type: 'M', x: 1.55, y: 0.09 },
        { type: 'L', x: -1.55, y: -0.003 },
        { type: 'L', x: -1.47, y: -0.01 },
        { type: 'Z' },
      ]),
    ).toBe('M1.55 0.09L-1.55 0L-1.47 -0.01Z');
  });

  it('formats C and Q commands with all coordinates separated', () => {
    expect(
      build([
        { type: 'C', x1: 1, y1: -0.004, x2: 2, y2: 3, x: -4, y: 0 },
        { type: 'Q', x1: 0, y1: 1, x: -2, y: -0.002 },
      ]),
    ).toBe('C1 0 2 3 -4 0Q0 1 -2 0');
  });

  it('produces parseable path data (round-trips through the SVG parser)', () => {
    const d = build([
      { type: 'M', x: -1.83, y: -0.07 },
      { type: 'L', x: -1.55, y: -0.004 }, // the fusing case
      { type: 'Z' },
    ]);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    // A valid 2-point closed path has a non-empty length; a malformed one is 0.
    expect(d).not.toContain('-1.550');
  });
});

describe('outlineUnsupportedText — whitespace around outlined glyphs', () => {
  const ARROW = 0x2194; // ↔ — the <xfer> glyph; uncovered by HN, outlined to a path.

  // Minimal opentype.Font stand-in: covers the codepoints for which `covered`
  // returns true, and traces any glyph to a trivial 1×1 triangle.
  const fakeFont = (covered: (cp: number) => boolean): opentype.Font =>
    ({
      charToGlyphIndex: (ch: string) => (covered(ch.codePointAt(0) ?? -1) ? 7 : 0),
      getPath: (_t: string, x: number, y: number) => ({
        commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
      }),
    }) as unknown as opentype.Font;

  const fonts = {
    hn: fakeFont((cp) => cp !== ARROW), // HN covers everything but the arrow
    symbols: [fakeFont((cp) => cp === ARROW)], // DejaVu stand-in traces the arrow
  };

  // Build a one-line <text> with monotonic pen positions (each UTF-16 unit
  // advances 10px on y=0), the way the browser's getStartPositionOfChar reports
  // them after baseline normalization.
  function seed(content: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const text = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    text.setAttribute('fill', '#111');
    text.textContent = content;
    (
      text as unknown as { getStartPositionOfChar: (i: number) => { x: number; y: number } }
    ).getStartPositionOfChar = (i: number) => ({ x: 10 * i, y: 0 });
    svg.appendChild(text);
    document.body.appendChild(svg);
    return svg;
  }

  it('marks the covered run after a glyph with white-space: pre so its leading spaces survive', () => {
    // "↔  Out": the <xfer> arrow, two typed spaces, then a word. The arrow is
    // outlined to a <path>; "  Out" becomes a positioned covered run whose two
    // leading spaces svg2pdf would trim (collapsing the gap) unless the run
    // preserves whitespace — the same mechanism the app's label text uses.
    const svg = seed('↔  Out');
    try {
      outlineUnsupportedText(svg, fonts);
      const runs = svg.querySelectorAll('text');
      expect(runs.length).toBe(1); // the single split covered run
      const run = runs[0] as SVGTextElement;
      expect(run.textContent).toBe('  Out'); // spaces retained in the content…
      expect(run.style.whiteSpace).toBe('pre'); // …and kept from svg2pdf's trim
      // Anchored at the first space; with the spaces preserved, "O" still lands
      // at its measured position (x=30), so the gap the user typed is intact.
      expect(run.getAttribute('x')).toBe('10');
    } finally {
      document.body.removeChild(svg);
    }
  });
});

// Guards the glyph-shortcut choices (labelTokens.ts) against a font swap that
// silently drops a symbol from the PDF. `<c>` (©) and `<tm>` (™) are covered by
// the embedded Helvetica Neue itself, so the export keeps them as selectable HN
// text; `<xfer>` (↔) is NOT in HN and relies on the DejaVu Sans outline tracer.
describe('shipped fonts cover the glyph-shortcut codepoints', () => {
  const parseFont = (file: string): opentype.Font => {
    const buf = readFileSync(`public/fonts/${file}`);
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  const hn = parseFont('HelveticaNeueRoman.ttf');
  const dejavu = parseFont('DejaVuSans.ttf');
  const covers = (font: opentype.Font, cp: number) =>
    font.charToGlyphIndex(String.fromCodePoint(cp)) !== 0;

  const COPY = 0x00a9; // ©  <c>
  const TM = 0x2122; // ™  <tm>
  const XFER = 0x2194; // ↔  <xfer>

  it('Helvetica Neue covers © and ™ (they stay selectable text in the PDF)', () => {
    expect(covers(hn, COPY)).toBe(true);
    expect(covers(hn, TM)).toBe(true);
  });

  it('DejaVu Sans covers ©, ™, and the HN-lacking ↔ (outline fallback)', () => {
    expect(covers(dejavu, COPY)).toBe(true);
    expect(covers(dejavu, TM)).toBe(true);
    expect(covers(dejavu, XFER)).toBe(true);
    expect(covers(hn, XFER)).toBe(false); // ↔ is why the tracer exists
  });

  it('traces © and ™ to non-empty outline path data (tracer fallback works)', () => {
    for (const cp of [COPY, TM]) {
      const d = glyphPathData(dejavu.getPath(String.fromCodePoint(cp), 0, 0, 16));
      expect(d.length).toBeGreaterThan(0);
    }
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
