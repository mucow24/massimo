import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import {
  collectStyledChars,
  loadOutlineFonts,
  outlineAllText,
  glyphPathData,
  pickFace,
  resolveTextStyle,
  symbolFontFor,
} from './pdfGlyphs';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

  it('formats a C command with all coordinates separated', () => {
    expect(build([{ type: 'C', x1: 1, y1: -0.004, x2: 2, y2: 3, x: -4, y: 0 }])).toBe(
      'C1 0 2 3 -4 0',
    );
  });

  it('converts a quadratic (Q) to the exact cubic (C) — svg2pdf flattens Q otherwise', () => {
    // TrueType glyphs are quadratic; PDF has no Q operator and svg2pdf flattens
    // each Q into a line fan (300k+ segments on a real map). The exact cubic:
    // C1 = P0 + ⅔(Q−P0), C2 = P2 + ⅔(Q−P2). From M(0,0), control (0,12), end
    // (12,12) → C1 (0,8), C2 (4,12).
    expect(
      build([{ type: 'M', x: 0, y: 0 }, { type: 'Q', x1: 0, y1: 12, x: 12, y: 12 }, { type: 'Z' }]),
    ).toBe('M0 0C0 8 4 12 12 12Z');
    expect(
      build([
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 0, y1: 12, x: 12, y: 12 },
      ]),
    ).not.toContain('Q');
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

// Guards the glyph-shortcut choices (labelTokens.ts) against a font swap that
// silently drops a symbol from the export. Söhne carries the arrows as well as
// © and ™ — unlike Helvetica Neue, which needed the fallback for ↔ — but it has
// no dingbats, so `<air>` (✈) and its neighbours still ride on DejaVu Sans.
//
// Both faces are read straight off /public/fonts. The Söhne .ttf files are
// git-ignored (licensed, not redistributable), so CI injects them from the
// private fonts repo before running this — see .github/workflows/ci.yml.
describe('shipped fonts cover the glyph-shortcut codepoints', () => {
  const parseFont = (file: string): opentype.Font => {
    const buf = readFileSync(`public/fonts/${file}`);
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  const dejavu = parseFont('DejaVuSans.ttf');
  const covers = (font: opentype.Font, cp: number) =>
    font.charToGlyphIndex(String.fromCodePoint(cp)) !== 0;

  const COPY = 0x00a9; // ©  <c>
  const TM = 0x2122; // ™  <tm>
  const XFER = 0x2194; // ↔  <xfer>
  const AIR = 0x2708; // ✈  <air>

  it('the text face covers ©, ™ and ↔ — but not the ✈ dingbat', () => {
    const text = parseFont('soehne-buch.ttf');
    expect(covers(text, COPY)).toBe(true);
    expect(covers(text, TM)).toBe(true);
    expect(covers(text, XFER)).toBe(true);
    expect(covers(text, AIR)).toBe(false); // the dingbats are why the fallback exists
  });

  it('DejaVu Sans covers the ✈ dingbat the text face lacks (outline fallback)', () => {
    expect(covers(dejavu, AIR)).toBe(true);
    expect(covers(dejavu, COPY)).toBe(true);
    expect(covers(dejavu, TM)).toBe(true);
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

describe('collectStyledChars', () => {
  it('pairs each codepoint with its UTF-16 index and governing element', () => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.appendChild(document.createTextNode('AB'));
    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.textContent = 'C';
    text.appendChild(tspan);
    text.appendChild(document.createTextNode('D'));

    const chars = collectStyledChars(text);
    expect(chars.map((c) => String.fromCodePoint(c.cp)).join('')).toBe('ABCD');
    expect(chars.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    // A, B, D are governed by the <text>; C — inside the <tspan> — by the tspan.
    // This is what lets a mixed-weight/mixed-colour run outline per span.
    expect(chars.map((c) => c.styleEl)).toEqual([text, text, tspan, text]);
  });

  it('advances the index by two UTF-16 units for an astral character', () => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.textContent = 'A\u{1F680}B'; // A, 🚀 (astral pair), B
    const chars = collectStyledChars(text);
    expect(chars.map((c) => c.index)).toEqual([0, 1, 3]); // rocket occupies indices 1–2
    expect(chars[1].cp).toBe(0x1f680);
  });
});

describe('resolveTextStyle', () => {
  it('reads weight/style/size/fill straight off the element', () => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-style', 'italic');
    text.setAttribute('font-size', '18');
    text.setAttribute('fill', '#f00');
    expect(resolveTextStyle(text)).toEqual({
      weight: 700,
      italic: true,
      fontSize: 18,
      fill: '#f00',
    });
  });

  it('walks ancestors for absent attributes and normalizes off-ladder weight', () => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('fill', '#0a0');
    g.setAttribute('font-size', '12');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-weight', '650'); // off-ladder -> nearest shipped (600, tie low)
    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.textContent = 'x';
    text.appendChild(tspan);
    g.appendChild(text);

    const style = resolveTextStyle(tspan);
    expect(style.fill).toBe('#0a0'); // inherited from <g>
    expect(style.fontSize).toBe(12); // inherited from <g>
    expect(style.italic).toBe(false);
    expect(style.weight).toBe(600); // 650 -> nearest shipped weight (tie breaks low)
  });

  it('defaults fill and size when nothing sets them', () => {
    const text = document.createElementNS(SVG_NS, 'text');
    expect(resolveTextStyle(text, '#123')).toEqual({
      weight: 400,
      italic: false,
      fontSize: 16,
      fill: '#123',
    });
  });
});

describe('pickFace', () => {
  const f = (name: string) => ({ name }) as unknown as opentype.Font;
  it('returns the exact weight/style face when present', () => {
    const faces = new Map([
      ['400:false', f('regular')],
      ['700:false', f('bold')],
    ]);
    expect(pickFace(faces, 700, false)).toBe(faces.get('700:false'));
  });

  it('falls back to the nearest weight in the same style', () => {
    const faces = new Map([
      ['300:false', f('light')],
      ['700:false', f('bold')],
    ]);
    expect(pickFace(faces, 400, false)).toBe(faces.get('300:false')); // 100 away vs 300 away
  });

  it('never crosses styles for the nearest match, but takes any as last resort', () => {
    const faces = new Map([['400:true', f('italic')]]);
    // No roman face exists, so the italic is returned as the any-face fallback.
    expect(pickFace(faces, 400, false)).toBe(faces.get('400:true'));
  });

  it('returns null for an empty face set', () => {
    expect(pickFace(new Map(), 400, false)).toBeNull();
  });
});

describe('loadOutlineFonts — failure is loud, not silent', () => {
  const face = (weight: number, italic: boolean) => ({
    weight,
    italic,
    file: `fonts/x-${weight}${italic ? 'i' : ''}.ttf`,
    format: 'truetype' as const,
  });
  const dead: typeof fetch = async () => {
    throw new Error('404');
  };

  it('throws when faces were requested and every one failed to load', async () => {
    // The alternative is an export that quietly contains no labels at all —
    // which nothing downstream (or in e2e) can distinguish from a valid map.
    await expect(loadOutlineFonts([face(400, false)], dead)).rejects.toThrow(/font faces/i);
  });

  it('does NOT throw when no faces were requested (a textless map is legitimate)', async () => {
    const fonts = await loadOutlineFonts([], dead);
    expect(fonts.faces.size).toBe(0);
  });
});

describe('outlineAllText — never silently deletes a label', () => {
  /** A <text> with stubbed pen positions, attached so querySelectorAll finds it. */
  function seed(content: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const t = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    t.setAttribute('fill', '#111');
    t.textContent = content;
    (
      t as unknown as { getStartPositionOfChar: (i: number) => { x: number; y: number } }
    ).getStartPositionOfChar = (i: number) => ({ x: 10 * i, y: 0 });
    svg.appendChild(t);
    document.body.appendChild(svg);
    return svg;
  }

  const tracer = (covered: (cp: number) => boolean): opentype.Font =>
    ({
      charToGlyphIndex: (ch: string) => (covered(ch.codePointAt(0) ?? -1) ? 7 : 0),
      getPath: (_t: string, x: number, y: number) => ({
        commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
      }),
    }) as unknown as opentype.Font;

  it('keeps the <text> when no face could trace any of its glyphs', () => {
    // A font that failed to load must degrade to a fallback face, not erase the
    // label — the failure mode that turned a font hiccup into a blank map.
    const svg = seed('Canal St');
    try {
      outlineAllText(svg, { faces: new Map(), symbols: [] });
      expect(svg.querySelectorAll('text')).toHaveLength(1);
      expect(svg.querySelector('text')!.textContent).toBe('Canal St');
      expect(svg.querySelectorAll('path')).toHaveLength(0);
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('replaces the <text> with outlines when tracing succeeds', () => {
    const svg = seed('AB');
    try {
      outlineAllText(svg, { faces: new Map([['400:false', tracer(() => true)]]), symbols: [] });
      expect(svg.querySelectorAll('text')).toHaveLength(0);
      // Two distinct glyphs → two prototypes, one instance each.
      expect(svg.querySelectorAll('defs > path')).toHaveLength(2);
      expect(svg.querySelectorAll('use')).toHaveLength(2);
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('drops a <text> that had nothing to draw in the first place', () => {
    const svg = seed('   '); // whitespace only — no drawable glyphs
    try {
      outlineAllText(svg, { faces: new Map([['400:false', tracer(() => true)]]), symbols: [] });
      expect(svg.querySelectorAll('text')).toHaveLength(0);
    } finally {
      document.body.removeChild(svg);
    }
  });
});

// Every occurrence of a glyph used to carry its own full outline: a map with
// 4,751 drawn characters emitted 4,751 copies of ~70 distinct shapes. Tracing
// each shape ONCE into <defs> and placing instances with <use> collapses that,
// and svg2pdf turns a <use> into a real PDF Form XObject (one /Do invocation
// against one shared stream) — so the saving carries into the PDF, not just the
// SVG. These pin the contract that makes both halves work.
describe('outlineAllText — glyph prototypes in <defs>, instances as <use>', () => {
  /** A <text> (optionally inside a transformed <g>) with stubbed pen positions. */
  function seed(
    content: string,
    opts: { fill?: string; fontSize?: string; wrap?: boolean } = {},
  ): { svg: SVGSVGElement; text: SVGTextElement } {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const t = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    t.setAttribute('fill', opts.fill ?? '#111');
    if (opts.fontSize) t.setAttribute('font-size', opts.fontSize);
    t.textContent = content;
    (
      t as unknown as { getStartPositionOfChar: (i: number) => { x: number; y: number } }
    ).getStartPositionOfChar = (i: number) => ({ x: 10 * i, y: 5 });
    if (opts.wrap) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', 'rotate(30 0 0)');
      g.appendChild(t);
      svg.appendChild(g);
    } else {
      svg.appendChild(t);
    }
    document.body.appendChild(svg);
    return { svg, text: t };
  }

  // Traces a 1-unit triangle at the pen origin, so path data is independent of
  // the character — dedup must key off the codepoint, not the outline bytes.
  const tracer = (): opentype.Font =>
    ({
      charToGlyphIndex: () => 7,
      getPath: (_t: string, x: number, y: number) => ({
        commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
      }),
    }) as unknown as opentype.Font;

  const run = (svg: SVGSVGElement) =>
    outlineAllText(svg, { faces: new Map([['400:false', tracer()]]), symbols: [] });

  it('traces a repeated glyph once and places each occurrence with a <use>', () => {
    const { svg } = seed('AA');
    try {
      run(svg);
      // One prototype, two instances — not two full outlines.
      expect(svg.querySelectorAll('defs > path')).toHaveLength(1);
      const uses = [...svg.querySelectorAll('use')];
      expect(uses).toHaveLength(2);
      const id = svg.querySelector('defs > path')!.getAttribute('id')!;
      expect(id).toBeTruthy();
      expect(uses.map((u) => u.getAttribute('href'))).toEqual([`#${id}`, `#${id}`]);
      // Both href forms: SVG 1.1 consumers only resolve the xlink one, and they
      // render NOTHING (not a fallback) for a reference they can't follow.
      const XLINK = 'http://www.w3.org/1999/xlink';
      expect(uses.map((u) => u.getAttributeNS(XLINK, 'href'))).toEqual([`#${id}`, `#${id}`]);
      // Declared once on the root, not repeated on every instance.
      expect(svg.getAttribute('xmlns:xlink')).toBe(XLINK);
      expect(svg.querySelectorAll('text')).toHaveLength(0);
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('gives each distinct codepoint its own prototype', () => {
    const { svg } = seed('ABA');
    try {
      run(svg);
      expect(svg.querySelectorAll('defs > path')).toHaveLength(2);
      expect(svg.querySelectorAll('use')).toHaveLength(3);
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('places each instance with translate(pen) scale(fontSize/em)', () => {
    // The prototype is traced at a fixed em size, so the instance transform
    // carries BOTH the browser-measured pen position and the size. Order
    // matters: translate-then-scale is scale-applied-first, which is what puts
    // an em-space outline at the right place at the right size.
    const { svg } = seed('AA', { fontSize: '20' });
    try {
      run(svg);
      const uses = [...svg.querySelectorAll('use')];
      expect(uses[0].getAttribute('transform')).toBe('translate(0,5) scale(0.02)');
      expect(uses[1].getAttribute('transform')).toBe('translate(10,5) scale(0.02)');
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('bakes the fill onto the prototype, so one shape in two colours is two prototypes', () => {
    // svg2pdf builds a <use>'s render context from AttributeState.default() —
    // the fill on the <use> is NOT inherited into the form object. Baking it
    // onto the referenced path is what keeps the PDF from drawing every glyph
    // black.
    const a = seed('A', { fill: '#111' });
    const b = seed('A', { fill: '#c00' });
    try {
      run(a.svg);
      run(b.svg);
      expect(a.svg.querySelector('defs > path')!.getAttribute('fill')).toBe('#111');
      expect(b.svg.querySelector('defs > path')!.getAttribute('fill')).toBe('#c00');
      // The instance carries no fill of its own — the prototype owns it.
      expect(a.svg.querySelector('use')!.getAttribute('fill')).toBeNull();
    } finally {
      document.body.removeChild(a.svg);
      document.body.removeChild(b.svg);
    }
  });

  it('leaves each <use> where the <text> stood, so ancestor transforms still apply', () => {
    // Pen positions are in the <text>'s own user space. The instances have to
    // stay under the same rotated <g> the label lives in, exactly as the inline
    // outline paths did.
    const { svg } = seed('AB', { wrap: true });
    try {
      run(svg);
      const g = svg.querySelector('g')!;
      expect(g.getAttribute('transform')).toBe('rotate(30 0 0)');
      expect(g.querySelectorAll('use')).toHaveLength(2);
      expect(svg.querySelectorAll('use')).toHaveLength(2); // none escaped the <g>
    } finally {
      document.body.removeChild(svg);
    }
  });

  /** A `<text>` whose second character sits in a bold `<tspan>`, so one codepoint
   *  resolves through two different faces in a single run. */
  function seedTwoWeights(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const t = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    t.setAttribute('fill', '#111');
    t.appendChild(document.createTextNode('A'));
    const bold = document.createElementNS(SVG_NS, 'tspan');
    bold.setAttribute('font-weight', '700');
    bold.textContent = 'A';
    t.appendChild(bold);
    (
      t as unknown as { getStartPositionOfChar: (i: number) => { x: number; y: number } }
    ).getStartPositionOfChar = (i: number) => ({ x: 10 * i, y: 5 });
    svg.appendChild(t);
    document.body.appendChild(svg);
    return svg;
  }

  /** Like `tracer`, but only claims the codepoints `covered` accepts. */
  const tracerCovering = (covered: (cp: number) => boolean): opentype.Font =>
    ({
      charToGlyphIndex: (ch: string) => (covered(ch.codePointAt(0) ?? -1) ? 7 : 0),
      getPath: (_t: string, x: number, y: number) => ({
        commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
      }),
    }) as unknown as opentype.Font;

  it('gives one character in two faces a prototype each', () => {
    // The key spans the FACE, not just the codepoint. Without that, a bold "A"
    // would silently reuse the regular "A"'s outline — same letter, wrong shape,
    // and nothing about the output would look obviously broken.
    const svg = seedTwoWeights();
    try {
      outlineAllText(svg, {
        faces: new Map([
          ['400:false', tracer()],
          ['700:false', tracer()],
        ]),
        symbols: [],
      });
      expect(svg.querySelectorAll('defs > path')).toHaveLength(2);
      const hrefs = [...svg.querySelectorAll('use')].map((u) => u.getAttribute('href'));
      expect(hrefs).toHaveLength(2);
      expect(new Set(hrefs).size).toBe(2); // two distinct prototypes, not one reused
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('keeps a symbol-font fallback separate from the same character in a main face', () => {
    // Same codepoint, but the bold face doesn't cover it so it traces from the
    // symbol font instead. Two different faces, therefore two prototypes — the
    // dingbat case (✈ from DejaVu) sharing a codepoint with a covered glyph.
    const svg = seedTwoWeights();
    try {
      outlineAllText(svg, {
        faces: new Map([
          ['400:false', tracerCovering(() => true)],
          ['700:false', tracerCovering(() => false)], // forces the fallback
        ]),
        symbols: [tracerCovering(() => true)],
      });
      expect(svg.querySelectorAll('defs > path')).toHaveLength(2);
      expect(
        new Set([...svg.querySelectorAll('use')].map((u) => u.getAttribute('href'))).size,
      ).toBe(2);
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('traces the prototype at the em origin, never at the pen position', () => {
    // The whole scheme rests on the prototype being position- and size-free: the
    // pen position and the font size ride on the <use> transform instead. Trace
    // at the pen instead and one prototype can no longer serve every occurrence —
    // every glyph would land on top of the first one that claimed the key.
    const calls: { ch: string; x: number; y: number; size: number }[] = [];
    const recording = {
      charToGlyphIndex: () => 7,
      getPath: (ch: string, x: number, y: number, size: number) => {
        calls.push({ ch, x, y, size });
        return {
          commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
        };
      },
    } as unknown as opentype.Font;

    const { svg } = seed('AB', { fontSize: '20' });
    try {
      outlineAllText(svg, { faces: new Map([['400:false', recording]]), symbols: [] });
      // The stub's pen positions are (0,5) and (10,5) — neither may appear here.
      expect(calls).toEqual([
        { ch: 'A', x: 0, y: 0, size: 1000 },
        { ch: 'B', x: 0, y: 0, size: 1000 },
      ]);
      // ...and the emitted outline starts at the origin, not at a pen position.
      for (const p of svg.querySelectorAll('defs > path')) {
        expect(p.getAttribute('d')).toMatch(/^M0 0/);
      }
    } finally {
      document.body.removeChild(svg);
    }
  });

  it('still keeps the <text> when nothing could be traced', () => {
    const { svg } = seed('Canal St');
    try {
      outlineAllText(svg, { faces: new Map(), symbols: [] });
      expect(svg.querySelectorAll('text')).toHaveLength(1);
      expect(svg.querySelectorAll('use')).toHaveLength(0);
      expect(svg.querySelectorAll('defs')).toHaveLength(0); // no orphan prototypes
    } finally {
      document.body.removeChild(svg);
    }
  });
});
