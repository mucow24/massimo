import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  FONT_TABLE,
  fontUrl,
  collectUsedFontFaces,
  contextualAlternate,
  resolveTextStyle,
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

// FONT_TABLE and the `@font-face` blocks in styles.css are two hand-typed
// copies of one list, and nothing derives either from the other. They have to
// name the SAME FILE for each weight/style, because the browser measures a
// label in the face styles.css loaded while the tracer outlines it in the face
// FONT_TABLE names: point them at different files and the pen positions the
// export places glyphs at stop belonging to the glyphs it places there. The
// drift is invisible on screen and invisible in the unit suite — it shows up as
// an exported map whose labels are subtly, uniformly wrong.
//
// The fallback order is guarded the same way in pdfGlyphs.test.ts ('the
// fallback chain agrees in all three places'); this is the face table itself.
describe('FONT_TABLE matches the @font-face blocks in styles.css', () => {
  const TEXT_FAMILY = 'Soehne';

  /** Every `@font-face` block declaring the map's text family, as a spec. */
  const cssFaces = (): FontFaceSpec[] => {
    const css = readFileSync('src/styles.css', 'utf8');
    const out: FontFaceSpec[] = [];
    for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      if (!new RegExp(`font-family:\\s*'${TEXT_FAMILY}'`).test(body)) continue;
      const src = /src:\s*url\('([^']+)'\)\s*format\('([^']+)'\)/.exec(body);
      const weight = /font-weight:\s*(\d+)\s*;/.exec(body);
      const style = /font-style:\s*(\w+)\s*;/.exec(body);
      expect(src, `@font-face block has no parseable src: ${body}`).not.toBeNull();
      expect(weight, `@font-face block has no single font-weight: ${body}`).not.toBeNull();
      out.push({
        // styles.css writes a root-absolute url (Vite base-rewrites it); the
        // table stores the same path base-relative, for `fontUrl` to prefix.
        file: src![1].replace(/^\//, ''),
        format: src![2] as FontFaceSpec['format'],
        weight: Number(weight![1]),
        italic: style?.[1] === 'italic',
      });
    }
    return out;
  };

  const byKey = (a: FontFaceSpec, b: FontFaceSpec) =>
    a.weight - b.weight || Number(a.italic) - Number(b.italic);

  it('declares the same file, format and style for every weight', () => {
    expect([...cssFaces()].sort(byKey)).toEqual([...FONT_TABLE].sort(byKey));
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

  // The seam between the two halves of the export's font handling: this decides
  // which faces get FETCHED, `resolveTextStyle` decides which face each
  // character is TRACED in, and a map whose labels carry their weight on an
  // ancestor group is where the two would part company. They share the resolver
  // so they cannot — this is what fails if some later edit un-shares it.
  it('agrees with resolveTextStyle on a face inherited from an ancestor', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('font-weight', '700');
    g.setAttribute('font-style', 'italic');
    const text = document.createElementNS(SVG_NS, 'text');
    text.textContent = 'X';
    g.appendChild(text);
    svg.appendChild(g);

    const { weight, italic } = resolveTextStyle(text);
    expect(collectUsedFontFaces(svg)).toEqual([want(weight, italic)]);
    expect(want(weight, italic)).toEqual(want(700, true));
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

// The app boots from its own origin and nothing else. It shipped a Google
// Fonts <link> for a while — three faces deep in a fallback stack behind
// Söhne, Massimo Symbols and DejaVu Sans, so it could never be reached, but
// still fetched on every boot. It cost a third-party round-trip in production
// and it was a real e2e failure anywhere the browser has no direct internet:
// migration.spec.ts is the one spec that gates on zero console errors, and a
// blocked stylesheet is a console error, so the whole file went red for a
// resource nothing renders. Self-hosting every face is the invariant — the
// tracer needs the files locally anyway.
describe('the boot document fetches nothing off-origin', () => {
  it('links no third-party resource', () => {
    const html = readFileSync('index.html', 'utf8');
    const offOrigin = [...html.matchAll(/(?:href|src)="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]);
    expect(offOrigin).toEqual([]);
  });
});
