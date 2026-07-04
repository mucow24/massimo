import { describe, it, expect } from 'vitest';
import { bakeLetterSpacing, shiftTextY, partitionRuns, type CharPos } from './pdfText';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeText(
  attrs: Record<string, string>,
  tspans: Record<string, string>[] = [],
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  for (const ts of tspans) {
    const s = document.createElementNS(SVG_NS, 'tspan');
    for (const [k, v] of Object.entries(ts)) s.setAttribute(k, v);
    t.appendChild(s);
  }
  return t as SVGTextElement;
}

describe('shiftTextY', () => {
  it('adds the delta to the text y attribute', () => {
    const t = makeText({ y: '10' });
    shiftTextY(t, 5);
    expect(t.getAttribute('y')).toBe('15');
  });

  it('treats a missing y as 0', () => {
    const t = makeText({});
    shiftTextY(t, 4);
    expect(t.getAttribute('y')).toBe('4');
  });

  it('shifts tspans with an absolute y, leaving relative-dy tspans alone', () => {
    const t = makeText({ y: '0' }, [{ y: '20' }, { dy: '12' }]);
    shiftTextY(t, 3);
    const spans = t.querySelectorAll('tspan');
    expect(spans[0].getAttribute('y')).toBe('23');
    expect(spans[1].getAttribute('y')).toBeNull();
    expect(spans[1].getAttribute('dy')).toBe('12'); // relative offset untouched
  });

  it('is a no-op when the delta is 0', () => {
    const t = makeText({}); // no y attribute
    shiftTextY(t, 0);
    expect(t.getAttribute('y')).toBeNull();
  });

  it('handles negative and fractional deltas', () => {
    const t = makeText({ y: '10' });
    shiftTextY(t, -2.5);
    expect(t.getAttribute('y')).toBe('7.5');
  });
});

describe('bakeLetterSpacing', () => {
  // jsdom has no SVG layout: stub the computed length per element.
  function svgWith(
    texts: { content: string; spacing?: string; computedLength?: number }[],
  ): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    for (const t of texts) {
      const el = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
      el.textContent = t.content;
      if (t.spacing !== undefined) el.setAttribute('letter-spacing', t.spacing);
      (el as unknown as { getComputedTextLength: () => number }).getComputedTextLength = () =>
        t.computedLength ?? 0;
      svg.appendChild(el);
    }
    return svg;
  }

  it('converts letter-spacing to textLength minus the trailing spacing', () => {
    // 'abcd' at 2px spacing measures 50 with spacing applied (incl. the
    // trailing 2px after the last glyph). textLength excludes that trailing
    // spacing so browsers re-derive exactly 2px per inter-glyph gap.
    const svg = svgWith([{ content: 'abcd', spacing: '2', computedLength: 50 }]);
    bakeLetterSpacing(svg);
    const t = svg.querySelector('text')!;
    expect(t.getAttribute('textLength')).toBe('48');
    expect(t.getAttribute('lengthAdjust')).toBe('spacing');
    expect(t.getAttribute('letter-spacing')).toBeNull();
  });

  it('measures the tracked advance while letter-spacing is still applied', () => {
    // Real browsers fold letter-spacing into getComputedTextLength, so the
    // tracked advance is only readable WHILE the attribute is present. Model
    // that: the stub returns the tracked width with the attribute set and the
    // untracked width once it's removed. The bake must read the tracked width
    // (50) — reading after removal (42) would bake a compressed textLength and
    // the run would drop its tracking in the PDF.
    const TRACKED = 50; // 'abcd' + 2px after each of 4 glyphs over a 42px base
    const UNTRACKED = 42;
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const el = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    el.textContent = 'abcd';
    el.setAttribute('letter-spacing', '2');
    (el as unknown as { getComputedTextLength: () => number }).getComputedTextLength = () =>
      el.getAttribute('letter-spacing') !== null ? TRACKED : UNTRACKED;
    svg.appendChild(el);
    bakeLetterSpacing(svg);
    expect(el.getAttribute('textLength')).toBe('48'); // 50 − 2, not 42 − 2
  });

  it('leaves untracked text alone', () => {
    const svg = svgWith([{ content: 'abcd' }, { content: 'ef', spacing: '0', computedLength: 20 }]);
    bakeLetterSpacing(svg);
    for (const t of Array.from(svg.querySelectorAll('text'))) {
      expect(t.getAttribute('textLength')).toBeNull();
      expect(t.getAttribute('lengthAdjust')).toBeNull();
    }
  });

  it('drops the attribute but skips textLength on runs with fewer than two characters', () => {
    // A single glyph has no inter-glyph gap: textLength would divide by zero
    // in svg2pdf's charSpace math. The spacing attribute still comes off so
    // the run renders identically everywhere (trailing spacing is invisible).
    const svg = svgWith([{ content: 'x', spacing: '3', computedLength: 10 }]);
    bakeLetterSpacing(svg);
    const t = svg.querySelector('text')!;
    expect(t.getAttribute('textLength')).toBeNull();
    expect(t.getAttribute('letter-spacing')).toBeNull();
  });
});

describe('partitionRuns', () => {
  const A = 65;
  const B = 66;
  const PLANE = 0x2708; // ✈ — treated as uncovered below
  const ARROW = 0x1f858; // 🡘 — astral, uncovered
  const coveredExcept =
    (...uncov: number[]) =>
    (cp: number) =>
      !uncov.includes(cp);

  it('splits a covered run, an uncovered glyph, then another covered run', () => {
    const chars: CharPos[] = [
      { cp: A, x: 0, y: 0 },
      { cp: PLANE, x: 10, y: 0 },
      { cp: B, x: 30, y: 0 },
    ];
    expect(partitionRuns(chars, coveredExcept(PLANE))).toEqual([
      { kind: 'text', x: 0, y: 0, text: 'A' },
      { kind: 'glyph', x: 10, y: 0, cp: PLANE },
      { kind: 'text', x: 30, y: 0, text: 'B' },
    ]);
  });

  it('keeps a fully-covered line as a single text run', () => {
    const chars: CharPos[] = [
      { cp: A, x: 0, y: 0 },
      { cp: B, x: 8, y: 0 },
    ];
    expect(partitionRuns(chars, coveredExcept())).toEqual([
      { kind: 'text', x: 0, y: 0, text: 'AB' },
    ]);
  });

  it('breaks a covered run at a line (y) jump', () => {
    const chars: CharPos[] = [
      { cp: A, x: 0, y: 0 },
      { cp: B, x: 0, y: 20 },
    ];
    expect(partitionRuns(chars, coveredExcept())).toEqual([
      { kind: 'text', x: 0, y: 0, text: 'A' },
      { kind: 'text', x: 0, y: 20, text: 'B' },
    ]);
  });

  it('emits a standalone astral glyph as one piece carrying its codepoint', () => {
    expect(partitionRuns([{ cp: ARROW, x: 5, y: 0 }], coveredExcept(ARROW))).toEqual([
      { kind: 'glyph', x: 5, y: 0, cp: ARROW },
    ]);
  });

  it('emits consecutive uncovered glyphs without a text run between them', () => {
    const chars: CharPos[] = [
      { cp: PLANE, x: 0, y: 0 },
      { cp: ARROW, x: 10, y: 0 },
    ];
    expect(partitionRuns(chars, coveredExcept(PLANE, ARROW))).toEqual([
      { kind: 'glyph', x: 0, y: 0, cp: PLANE },
      { kind: 'glyph', x: 10, y: 0, cp: ARROW },
    ]);
  });
});
