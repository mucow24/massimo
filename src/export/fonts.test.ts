import { describe, it, expect } from 'vitest';
import { FONT_TABLE, fontUrl, collectUsedFontFaces, type FontFaceSpec } from './fonts';

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
    expect(fontUrl('fonts/HelveticaNeueRoman.ttf', '/massimo/')).toBe(
      '/massimo/fonts/HelveticaNeueRoman.ttf',
    );
    expect(fontUrl('fonts/DejaVuSans.ttf', '/')).toBe('/fonts/DejaVuSans.ttf');
    expect(fontUrl('fonts/DejaVuSans.ttf', './')).toBe('./fonts/DejaVuSans.ttf');
  });

  it('defaults to the build-time BASE_URL (root in dev/test)', () => {
    expect(fontUrl('fonts/HelveticaNeueRoman.ttf')).toBe('/fonts/HelveticaNeueRoman.ttf');
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
