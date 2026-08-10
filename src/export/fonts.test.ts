import { describe, it, expect } from 'vitest';
import {
  FONT_TABLE,
  fontUrl,
  collectUsedFontFaces,
  contextualAlternate,
  type FontFaceSpec,
} from './fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build a tiny SVG subtree with `<text>` nodes carrying the given faces. */
function svgWithText(specs: { weight?: string; style?: string }[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const s of specs) {
    const t = document.createElementNS(SVG_NS, 'text');
    if (s.weight != null) t.setAttribute('font-weight', s.weight);
    if (s.style != null) t.setAttribute('font-style', s.style);
    t.textContent = 'X';
    svg.appendChild(t);
  }
  return svg;
}

describe('FONT_TABLE', () => {
  const WEIGHTS = [200, 300, 400, 500, 600, 700, 800, 900];

  it('covers all 8 weights in both styles (16 faces)', () => {
    expect(FONT_TABLE).toHaveLength(16);
    for (const w of WEIGHTS) {
      for (const italic of [false, true]) {
        const hit = FONT_TABLE.filter((f) => f.weight === w && f.italic === italic);
        expect(hit, `weight ${w} italic=${italic}`).toHaveLength(1);
      }
    }
  });

  it('points every face at a base-relative fonts/ file with a matching format', () => {
    for (const f of FONT_TABLE) {
      // No leading slash: base-relative so BASE_URL can be prefixed at fetch.
      expect(f.file).toMatch(/^fonts\/.+\.(otf|ttf)$/);
      const ext = f.file.endsWith('.ttf') ? 'ttf' : 'otf';
      expect(f.format).toBe(ext === 'ttf' ? 'truetype' : 'opentype');
    }
  });

  // The outline tracer parses these with opentype.js, which reads TrueType/
  // OpenType but not WOFF2 — so every face must be a parseable .ttf/.otf.
  it('uses parseable .ttf / truetype faces for all 16 entries', () => {
    expect(FONT_TABLE.filter((f) => f.format === 'truetype')).toHaveLength(16);
    for (const f of FONT_TABLE) {
      expect(f.file).toMatch(/\.ttf$/);
    }
  });
});

describe('fontUrl', () => {
  it('prefixes the given base to a base-relative path', () => {
    // Subpath prod build (e.g. GitHub Pages): the base must be carried through
    // or the fetch 404s — the bug #135 fixed, now shared by every font fetch.
    expect(fontUrl('fonts/soehne-buch.ttf', '/massimo/')).toBe('/massimo/fonts/soehne-buch.ttf');
    expect(fontUrl('fonts/DejaVuSans.ttf', '/')).toBe('/fonts/DejaVuSans.ttf');
    expect(fontUrl('fonts/DejaVuSans.ttf', './')).toBe('./fonts/DejaVuSans.ttf');
  });

  it('defaults to the build-time BASE_URL (root in dev/test)', () => {
    expect(fontUrl('fonts/soehne-buch.ttf')).toBe('/fonts/soehne-buch.ttf');
  });
});

describe('collectUsedFontFaces', () => {
  const want = (weight: number, italic: boolean): FontFaceSpec =>
    FONT_TABLE.find((f) => f.weight === weight && f.italic === italic)!;

  it('returns the distinct faces present in the subtree', () => {
    const svg = svgWithText([
      { weight: '400' },
      { weight: '700' },
      { weight: '700', style: 'italic' },
      { weight: '400' }, // dup
    ]);
    const faces = collectUsedFontFaces(svg);
    expect(faces).toEqual(
      expect.arrayContaining([want(400, false), want(700, false), want(700, true)]),
    );
    expect(faces).toHaveLength(3);
  });

  it('defaults missing weight/style to 400 normal', () => {
    const svg = svgWithText([{}]);
    expect(collectUsedFontFaces(svg)).toEqual([want(400, false)]);
  });

  it('normalizes keyword and off-table weights', () => {
    // 650 sits equidistant between the 600 and 700 rungs; normalizeWeight breaks
    // the tie low, so it resolves to SemiBold.
    const svg = svgWithText([{ weight: 'bold' }, { weight: '650', style: 'italic' }]);
    const faces = collectUsedFontFaces(svg);
    expect(faces).toEqual(expect.arrayContaining([want(700, false), want(600, true)]));
    expect(faces).toHaveLength(2);
  });
});

describe('contextualAlternate', () => {
  const cp = (ch: string) => ch.codePointAt(0)!;
  /** Substitution for the middle character of a 3-character window. */
  const mid = (window: string) => contextualAlternate(cp(window[0]), cp(window[1]), cp(window[2]));

  it('raises the colon to figure height between two figures (the time colon)', () => {
    expect(mid('2:3')).toEqual({ glyphName: 'colon.mid' });
    expect(mid('0:0')).toEqual({ glyphName: 'colon.mid' });
    expect(mid('9:9')).toEqual({ glyphName: 'colon.mid' });
  });

  it('turns x between two figures into a multiplication sign', () => {
    expect(mid('3x4')).toEqual({ cp: 0x00d7 });
    expect(mid('7X8')).toEqual({ cp: 0x00d7 }); // the capital substitutes too
  });

  it('leaves a colon alone when either neighbour is not a figure', () => {
    expect(mid('a:b')).toBeNull();
    expect(mid('1:b')).toBeNull();
    expect(mid('a:1')).toBeNull();
    expect(mid(' :1')).toBeNull();
  });

  it('leaves x alone when either neighbour is not a figure', () => {
    // Notably the SPACED form: the font substitutes there, this deliberately
    // does not (see the doc comment).
    expect(mid('1x-')).toBeNull();
    expect(mid('axb')).toBeNull();
    expect(contextualAlternate(cp(' '), cp('x'), cp(' '))).toBeNull();
  });

  it('substitutes nothing at a run edge, where there is no neighbour', () => {
    expect(contextualAlternate(null, cp(':'), cp('3'))).toBeNull();
    expect(contextualAlternate(cp('3'), cp(':'), null)).toBeNull();
    expect(contextualAlternate(null, cp('x'), null)).toBeNull();
  });

  it('substitutes nothing for characters no rule covers', () => {
    expect(mid('1y2')).toBeNull();
    expect(mid('1.2')).toBeNull();
    expect(mid('1-2')).toBeNull();
    expect(mid('121')).toBeNull();
  });
});
