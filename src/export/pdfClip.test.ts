import { describe, it, expect } from 'vitest';
import { flattenClipPathTransforms } from './pdfClip';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Parse SVG markup the way the export pipeline does (real SVG-namespaced nodes,
 * not the HTML-parsed elements `innerHTML` yields in jsdom). */
function svgWith(inner: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGSVGElement;
}

describe('flattenClipPathTransforms', () => {
  it('bakes a uniform scale on a clipPath child into its coordinates', () => {
    // The real shape: a region-exclude clip authored at ×64 and pulled back with
    // scale(1/64). Baking must reproduce the exact same region at plain scale.
    const svg = svgWith(
      '<clipPath id="c"><path transform="scale(0.5)" d="M 100 200 L 300 200 L 300 400 Z"/></clipPath>',
    );
    flattenClipPathTransforms(svg);
    const p = svg.querySelector('clipPath > path')!;
    expect(p.hasAttribute('transform')).toBe(false);
    expect(p.getAttribute('d')).toBe('M 50 100 L 150 100 L 150 200 Z');
  });

  it('handles scale(s, s) written with two equal args', () => {
    const svg = svgWith(
      '<clipPath id="c"><path transform="scale(2, 2)" d="M 1 2 L 3 4 Z"/></clipPath>',
    );
    flattenClipPathTransforms(svg);
    const p = svg.querySelector('clipPath > path')!;
    expect(p.getAttribute('d')).toBe('M 2 4 L 6 8 Z');
    expect(p.hasAttribute('transform')).toBe(false);
  });

  it('leaves a NON-uniform scale untouched (multiplying every number is invalid)', () => {
    const svg = svgWith(
      '<clipPath id="c"><path transform="scale(2, 3)" d="M 1 2 L 3 4 Z"/></clipPath>',
    );
    flattenClipPathTransforms(svg);
    const p = svg.querySelector('clipPath > path')!;
    expect(p.getAttribute('transform')).toBe('scale(2, 3)');
    expect(p.getAttribute('d')).toBe('M 1 2 L 3 4 Z');
  });

  it('leaves an arc path untouched (flags/angles must not be scaled)', () => {
    const d = 'M 0 0 A 10 10 0 0 1 20 20 Z';
    const svg = svgWith(`<clipPath id="c"><path transform="scale(0.5)" d="${d}"/></clipPath>`);
    flattenClipPathTransforms(svg);
    const p = svg.querySelector('clipPath > path')!;
    expect(p.getAttribute('transform')).toBe('scale(0.5)');
    expect(p.getAttribute('d')).toBe(d);
  });

  it('ignores clip children that carry no transform', () => {
    const svg = svgWith('<clipPath id="c"><path d="M 1 2 L 3 4 Z"/></clipPath>');
    flattenClipPathTransforms(svg);
    expect(svg.querySelector('clipPath > path')!.getAttribute('d')).toBe('M 1 2 L 3 4 Z');
  });
});
