import { describe, it, expect } from 'vitest';
import {
  FONT_TABLE,
  FONT_FAMILY,
  fontUrl,
  normalizeWeight,
  collectUsedFontFaces,
  buildEmbeddedFontCss,
  bytesToBase64,
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
  const WEIGHTS = [100, 200, 300, 400, 500, 700, 800, 900];

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

  it('uses .ttf / truetype faces for all 16 entries', () => {
    const ttf = FONT_TABLE.filter((f) => f.format === 'truetype');
    expect(ttf).toHaveLength(16);
    for (const f of FONT_TABLE) {
      expect(f.format).toBe('truetype');
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

describe('normalizeWeight', () => {
  it('maps keywords', () => {
    expect(normalizeWeight('normal')).toBe(400);
    expect(normalizeWeight('bold')).toBe(700);
    expect(normalizeWeight(null)).toBe(400);
    expect(normalizeWeight('')).toBe(400);
  });

  it('passes through exact table weights', () => {
    for (const w of [100, 200, 300, 400, 500, 700, 800, 900]) {
      expect(normalizeWeight(String(w))).toBe(w);
    }
  });

  it('rounds off-table weights to the nearest available weight', () => {
    expect(normalizeWeight('650')).toBe(700); // 600 not in table
    expect(normalizeWeight('600')).toBe(500); // tie -> lower (500 vs 700 both 100 away)
    expect(normalizeWeight('1000')).toBe(900);
    expect(normalizeWeight('50')).toBe(100);
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
    const svg = svgWithText([{ weight: 'bold' }, { weight: '650', style: 'italic' }]);
    const faces = collectUsedFontFaces(svg);
    expect(faces).toEqual(expect.arrayContaining([want(700, false), want(700, true)]));
    expect(faces).toHaveLength(2);
  });
});

describe('buildEmbeddedFontCss', () => {
  it('emits one @font-face per face with base64 data-URI src and matching descriptors', async () => {
    const faces = [
      FONT_TABLE.find((f) => f.weight === 400 && !f.italic)!,
      FONT_TABLE.find((f) => f.weight === 700 && f.italic)!,
    ];
    // Stub fetch: each font file returns 4 bytes.
    const fakeFetch = async () =>
      ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) as Response;

    const css = await buildEmbeddedFontCss(faces, fakeFetch);

    expect(css.match(/@font-face/g) ?? []).toHaveLength(2);
    expect(css).toContain(`font-family: '${FONT_FAMILY}'`);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-style: normal');
    expect(css).toContain('font-weight: 700');
    expect(css).toContain('font-style: italic');
    expect(css).toContain('base64,');
    expect(css).toContain("format('truetype')");
  });

  it('fetches each font file under the configured base path (subpath-safe)', async () => {
    const faces = [FONT_TABLE.find((f) => f.weight === 400 && !f.italic)!];
    const urls: string[] = [];
    const recordingFetch: typeof fetch = async (input) => {
      urls.push(String(input));
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as Response;
    };
    // Production builds serve from a subpath (e.g. GitHub Pages /massimo/). The
    // fetched URL must carry that base or it 404s and the face is silently
    // dropped — the bug that made exports fall back from Helvetica to Arial.
    await buildEmbeddedFontCss(faces, recordingFetch, '/massimo/');
    expect(urls).toEqual(['/massimo/fonts/HelveticaNeueRoman.ttf']);
  });

  it('skips faces whose font file fails to fetch', async () => {
    const faces = [FONT_TABLE.find((f) => f.weight === 400 && !f.italic)!];
    const failing = async () => {
      throw new Error('network');
    };
    const css = await buildEmbeddedFontCss(faces, failing);
    expect(css).toBe('');
  });
});

describe('bytesToBase64', () => {
  it('encodes a short payload', () => {
    // 'hi' — single chunk, sanity check against btoa.
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('encodes a payload spanning multiple 0x8000-byte chunks', () => {
    // The whole reason the function exists: chunking so `String.fromCharCode`
    // never gets an arg list past the call-stack cap on real (100s-of-KB) font
    // files. A single 'A'*(0x8000+5) input would blow that cap if spread in one
    // call; here it must cross >=2 chunks and still equal btoa of the same bytes.
    const n = 0x8000 + 5;
    const bytes = new Uint8Array(n).fill(65); // 'A'
    expect(bytesToBase64(bytes)).toBe(btoa('A'.repeat(n)));
  });
});
