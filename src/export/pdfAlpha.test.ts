import { describe, it, expect } from 'vitest';
import { splitAlphaColors } from './pdfAlpha';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgWith(attrs: Record<string, string>, tag = 'path') {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  svg.appendChild(el);
  return { svg, el };
}

describe('splitAlphaColors', () => {
  it('splits an 8-digit fill into a 6-digit color + fill-opacity (svg2pdf drops hex8 alpha)', () => {
    const { svg, el } = svgWith({ fill: '#11223380' });
    splitAlphaColors(svg);
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(Number(el.getAttribute('fill-opacity'))).toBeCloseTo(128 / 255, 6);
  });

  it('splits an 8-digit stroke into stroke + stroke-opacity', () => {
    const { svg, el } = svgWith({ stroke: '#aabbcc40' });
    splitAlphaColors(svg);
    expect(el.getAttribute('stroke')).toBe('#aabbcc');
    expect(Number(el.getAttribute('stroke-opacity'))).toBeCloseTo(64 / 255, 6);
  });

  it('composes with an existing fill-opacity by multiplying', () => {
    const { svg, el } = svgWith({ fill: '#11223380', 'fill-opacity': '0.5' });
    splitAlphaColors(svg);
    expect(Number(el.getAttribute('fill-opacity'))).toBeCloseTo((128 / 255) * 0.5, 6);
  });

  it('leaves a 6-digit fill untouched (no spurious fill-opacity)', () => {
    const { svg, el } = svgWith({ fill: '#112233' });
    splitAlphaColors(svg);
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(el.getAttribute('fill-opacity')).toBeNull();
  });

  it('leaves a non-hex paint (none / url ref) untouched', () => {
    const { svg, el } = svgWith({ fill: 'none', stroke: 'url(#hatch1)' });
    splitAlphaColors(svg);
    expect(el.getAttribute('fill')).toBe('none');
    expect(el.getAttribute('stroke')).toBe('url(#hatch1)');
    expect(el.getAttribute('fill-opacity')).toBeNull();
  });

  it('walks nested descendants', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const g = document.createElementNS(SVG_NS, 'g');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill', '#00000080');
    g.appendChild(p);
    svg.appendChild(g);
    splitAlphaColors(svg);
    expect(p.getAttribute('fill')).toBe('#000000');
    expect(Number(p.getAttribute('fill-opacity'))).toBeCloseTo(128 / 255, 6);
  });
});
