import { describe, it, expect } from 'vitest';
import { shiftTextY } from './pdfText';

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
