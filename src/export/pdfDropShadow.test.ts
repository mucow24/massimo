import { describe, it, expect } from 'vitest';
import { bakeHardDropShadow, bakeImageDropShadows } from './pdfDropShadow';

// A real logo from the user's map: a red "M" path inside a <g> that references a
// hard feDropShadow (dx=-3, dy=0, stdDeviation=0, white flood) — the legend logo.
const HARD_SHADOW_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
  '<defs><filter id="fx-1" x="-50%" y="-50%" width="200%" height="200%">' +
  '<feDropShadow in="SourceGraphic" dx="-3" dy="0" stdDeviation="0" flood-color="#ffffff" flood-opacity="1"/>' +
  '</filter></defs>' +
  '<g transform="translate(-50 -92.85)" filter="url(#fx-1)">' +
  '<path d="M137 137L96 137L129 248Z" fill="#d92626"/></g></svg>';

const parse = (markup: string): Document =>
  new DOMParser().parseFromString(markup, 'image/svg+xml');

describe('bakeHardDropShadow', () => {
  it('replaces a hard feDropShadow with an offset, flood-colored clone behind the original', () => {
    const out = bakeHardDropShadow(HARD_SHADOW_LOGO);
    const doc = parse(out);

    // The filter is gone — both the <filter> def and every filter="" reference.
    expect(doc.querySelectorAll('filter')).toHaveLength(0);
    expect(doc.querySelectorAll('[filter]')).toHaveLength(0);

    // Two copies of the M now exist: the baked shadow + the original.
    const paths = [...doc.querySelectorAll('path')];
    expect(paths).toHaveLength(2);

    const original = paths.find((p) => p.getAttribute('fill') === '#d92626');
    const shadow = paths.find((p) => p.getAttribute('fill') === '#ffffff');
    expect(original).toBeTruthy();
    expect(shadow).toBeTruthy();

    // Same outline (the shadow is a clone, not an approximation).
    expect(shadow!.getAttribute('d')).toBe(original!.getAttribute('d'));

    // The shadow carries the original transform PLUS the (dx,dy) offset, and is
    // painted first (drawn behind the original).
    const shadowG = shadow!.closest('g')!;
    const t = shadowG.getAttribute('transform') ?? '';
    expect(t).toContain('translate(-50 -92.85)');
    expect(t).toContain('translate(-3 0)');

    const allG = [...doc.querySelectorAll('g')];
    const originalG = original!.closest('g')!;
    expect(allG.indexOf(shadowG)).toBeLessThan(allG.indexOf(originalG));
  });

  it('leaves a blurred drop-shadow (stdDeviation>0) untouched — it cannot bake to exact geometry', () => {
    const blurred = HARD_SHADOW_LOGO.replace('stdDeviation="0"', 'stdDeviation="2"');
    const out = bakeHardDropShadow(blurred);
    const doc = parse(out);
    expect(doc.querySelectorAll('filter')).toHaveLength(1);
    expect(doc.querySelectorAll('[filter]')).toHaveLength(1);
    expect(doc.querySelectorAll('path')).toHaveLength(1);
  });

  it('returns markup with no drop-shadow filter unchanged', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    expect(bakeHardDropShadow(plain)).toBe(plain);
  });

  it('honors flood-opacity on the baked shadow', () => {
    const translucent = HARD_SHADOW_LOGO.replace('flood-opacity="1"', 'flood-opacity="0.5"');
    const doc = parse(bakeHardDropShadow(translucent));
    const shadow = [...doc.querySelectorAll('path')].find(
      (p) => p.getAttribute('fill') === '#ffffff',
    );
    expect(shadow!.closest('g')!.getAttribute('opacity')).toBe('0.5');
  });
});

describe('bakeImageDropShadows', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  it('rewrites a URL-encoded svg+xml image href in place, baking its drop-shadow', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(HARD_SHADOW_LOGO)}`);
    svg.appendChild(image);

    bakeImageDropShadows(svg);

    const href = image.getAttribute('href')!;
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    const decoded = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
    expect(decoded).not.toContain('<filter');
    expect(decoded).not.toContain('feDropShadow');
    expect(decoded).toContain('#ffffff'); // the baked shadow fill
  });

  it('decodes base64 svg+xml image hrefs too', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', `data:image/svg+xml;base64,${btoa(HARD_SHADOW_LOGO)}`);
    svg.appendChild(image);

    bakeImageDropShadows(svg);
    const href = image.getAttribute('href')!;
    const decoded = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
    expect(decoded).not.toContain('feDropShadow');
    expect(decoded).toContain('#ffffff');
  });

  it('leaves non-svg and shadow-free images alone', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const png = document.createElementNS(SVG_NS, 'image');
    png.setAttribute('href', 'data:image/png;base64,iVBORw0KGgo=');
    const plain = document.createElementNS(SVG_NS, 'image');
    const plainSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    plain.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(plainSvg)}`);
    svg.append(png, plain);

    bakeImageDropShadows(svg);

    expect(png.getAttribute('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(
      decodeURIComponent(plain.getAttribute('href')!.slice('data:image/svg+xml,'.length)),
    ).toBe(plainSvg);
  });
});
