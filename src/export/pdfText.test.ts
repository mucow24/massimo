import { describe, it, expect } from 'vitest';
import { shiftTextY, partitionRuns, type CharPos } from './pdfText';

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
