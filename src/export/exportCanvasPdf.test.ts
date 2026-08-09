import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bakeHatchedPaints, prepareSvgForPdf } from './exportCanvasPdf';
import { CLIP_RASTER_INVERSE_TRANSFORM } from '../components/canvas/clipRaster';
import { HATCH_STRIPE_WIDTH } from '../components/HatchPatterns';

const SVG_NS = 'http://www.w3.org/2000/svg';

// jsdom defines neither SVGPatternElement nor SVGPathElement — its <pattern>
// and <path> are plain SVGElement — so bakeHatchedPaints' instanceof branches
// would throw. Register minimal stand-ins as the missing globals and adopt
// fixture elements into them via setPrototypeOf (never constructed directly,
// so the "Illegal constructor" rule doesn't bite).
class PatternStub extends SVGElement {}
class PathStub extends SVGElement {}

let hadPattern = false;
let hadPath = false;
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  hadPattern = 'SVGPatternElement' in g;
  hadPath = 'SVGPathElement' in g;
  g.SVGPatternElement ??= PatternStub;
  g.SVGPathElement ??= PathStub;
});
afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (!hadPattern) delete g.SVGPatternElement;
  if (!hadPath) delete g.SVGPathElement;
});

// Matches the markup HatchPatterns emits: rect[0] is the stripe color,
// rect[1] the gap color, hatch angle in patternTransform.
const PATTERN =
  '<defs><pattern id="hatch--d92626" patternUnits="userSpaceOnUse" width="4" height="96"' +
  ' patternTransform="rotate(45)">' +
  '<rect x="0" y="0" width="2" height="96" fill="#d92626"></rect>' +
  '<rect x="2" y="0" width="2" height="96" fill="#ffffff"></rect>' +
  '</pattern></defs>';

const makeSvg = (innerHTML: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.innerHTML = innerHTML;
  for (const pat of svg.querySelectorAll('pattern')) {
    Object.setPrototypeOf(pat, PatternStub.prototype);
  }
  return svg;
};

// Adopt a fixture <path> as an SVGPathElement tracing a straight horizontal
// run from (0,0) to (len,0) — jsdom has no path geometry of its own.
const adoptStraightPath = (path: Element, len: number): void => {
  Object.setPrototypeOf(path, PathStub.prototype);
  const p = path as unknown as Record<string, unknown>;
  p.getTotalLength = () => len;
  p.getPointAtLength = (l: number) => ({ x: l, y: 0 });
};

describe('bakeHatchedPaints', () => {
  it('bakes a hatch-stroked band path into clipped stripe geometry', () => {
    const svg = makeSvg(
      PATTERN + '<path d="M0 0 H100" stroke="url(#hatch--d92626)" stroke-width="10"></path>',
    );
    adoptStraightPath(svg.querySelector('path')!, 100);

    bakeHatchedPaints(svg);

    // The pattern-painted path is gone, replaced by a clipped group.
    expect(svg.querySelector('[stroke^="url(#hatch"]')).toBeNull();
    const group = svg.querySelector('g[clip-path="url(#pdf-hatch-clip-0)"]')!;
    expect(group).toBeTruthy();

    // The clip is the stroke ribbon: a polygon spanning the ±width/2 offset of
    // the centerline, registered under <defs>.
    const clip = svg.querySelector('defs > clipPath#pdf-hatch-clip-0')!;
    expect(clip.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    expect(clip.children).toHaveLength(1);
    expect(clip.children[0].tagName).toBe('polygon');

    // Gap-colored backing rect sized to the ribbon bounds (x 0..100, y ±5).
    const bg = group.querySelector(':scope > rect')!;
    expect(bg.getAttribute('fill')).toBe('#ffffff');
    expect(bg.getAttribute('x')).toBe('0');
    expect(bg.getAttribute('y')).toBe('-5');
    expect(bg.getAttribute('width')).toBe('100');
    expect(bg.getAttribute('height')).toBe('10');

    // Stripes: stripe-colored columns in a frame rotated by the pattern angle.
    const stripes = group.querySelector(':scope > g')!;
    expect(stripes.getAttribute('transform')).toBe('rotate(45)');
    const cols = [...stripes.querySelectorAll('rect')];
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols) {
      expect(col.getAttribute('fill')).toBe('#d92626');
      expect(col.getAttribute('width')).toBe(String(HATCH_STRIPE_WIDTH));
    }
  });

  it('bakes a hatch-filled stop marker clipped to the shape itself', () => {
    const svg = makeSvg(
      PATTERN + '<polygon points="10,20 18,20 18,26 10,26" fill="url(#hatch--d92626)"></polygon>',
    );
    const marker = svg.querySelector('polygon')!;
    (marker as unknown as Record<string, unknown>).getBBox = () => ({
      x: 10,
      y: 20,
      width: 8,
      height: 6,
    });

    bakeHatchedPaints(svg);

    // The clip child is a paint-stripped clone of the marker shape.
    const clipChild = svg.querySelector('clipPath > polygon')!;
    expect(clipChild.getAttribute('points')).toBe('10,20 18,20 18,26 10,26');
    expect(clipChild.hasAttribute('fill')).toBe(false);

    // Backing rect covers the shape's bbox.
    const bg = svg.querySelector('g[clip-path] > rect')!;
    expect(bg.getAttribute('x')).toBe('10');
    expect(bg.getAttribute('y')).toBe('20');
    expect(bg.getAttribute('width')).toBe('8');
    expect(bg.getAttribute('height')).toBe('6');
    expect(svg.querySelector('[fill^="url(#hatch"]')).toBeNull();
  });

  it('gives each baked element its own clip when several share one pattern', () => {
    const svg = makeSvg(
      PATTERN +
        '<path d="M0 0 H100" stroke="url(#hatch--d92626)" stroke-width="10"></path>' +
        '<polygon points="0,0 8,0 8,6" fill="url(#hatch--d92626)"></polygon>',
    );
    adoptStraightPath(svg.querySelector('path')!, 100);
    const marker = svg.querySelector('polygon')!;
    (marker as unknown as Record<string, unknown>).getBBox = () => ({
      x: 0,
      y: 0,
      width: 8,
      height: 6,
    });

    bakeHatchedPaints(svg);

    expect(svg.querySelector('clipPath#pdf-hatch-clip-0')).toBeTruthy();
    expect(svg.querySelector('clipPath#pdf-hatch-clip-1')).toBeTruthy();
    expect(svg.querySelectorAll('g[clip-path]')).toHaveLength(2);
  });

  it('skips a hatch reference whose pattern is missing, without throwing', () => {
    const svg = makeSvg(
      PATTERN + '<path d="M0 0 H100" stroke="url(#hatch-nope)" stroke-width="10"></path>',
    );
    adoptStraightPath(svg.querySelector('path')!, 100);

    bakeHatchedPaints(svg);

    // Left untouched: still pattern-stroked, no clip emitted for it.
    expect(svg.querySelector('path[stroke="url(#hatch-nope)"]')).toBeTruthy();
    expect(svg.querySelector('clipPath')).toBeNull();
  });

  it('skips a hatch-stroked path with a non-positive stroke width', () => {
    const svg = makeSvg(
      PATTERN + '<path d="M0 0 H100" stroke="url(#hatch--d92626)" stroke-width="0"></path>',
    );
    adoptStraightPath(svg.querySelector('path')!, 100);

    bakeHatchedPaints(svg);

    expect(svg.querySelector('path[stroke^="url(#hatch"]')).toBeTruthy();
    expect(svg.querySelector('clipPath')).toBeNull();
  });

  it('is a no-op on an svg with no hatch paints', () => {
    const svg = makeSvg('<path d="M0 0 H100" stroke="#d92626" stroke-width="10"></path>');
    const before = svg.innerHTML;

    bakeHatchedPaints(svg);

    // No <defs> inserted, nothing rewritten.
    expect(svg.innerHTML).toBe(before);
  });
});

/**
 * Wiring guard. The clip hoist is only useful if the export pipeline actually
 * runs it — a correct `pdfClip` module wired to nothing still ships blank
 * bands. Driving the whole bake sequence (rather than calling the hoist
 * directly) is what makes deleting the call from `prepareSvgForPdf` go red.
 *
 * The fixture carries ONLY a clip, so every other bake in the sequence is a
 * no-op on it.
 */
describe('prepareSvgForPdf — region-exclude clip wiring', () => {
  it('leaves no transform on a clipPath child', async () => {
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" width="100" height="100">
         <defs><clipPath id="region-exclude-x" clipPathUnits="userSpaceOnUse">
           <path transform="${CLIP_RASTER_INVERSE_TRANSFORM}" d="M 0 0 L 640 0 L 640 640 Z"/>
         </clipPath></defs>
         <g clip-path="url(#region-exclude-x)"><rect x="0" y="0" width="9" height="9"/></g>
       </svg>`,
      'image/svg+xml',
    ).documentElement as unknown as SVGSVGElement;

    const holder = document.createElement('div');
    holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;');
    holder.appendChild(svg);
    document.body.appendChild(holder);
    try {
      await prepareSvgForPdf(svg);
      const child = svg.querySelector('clipPath > path')!;
      // Hoisted onto the clipPath, so a reused clip can't compound in svg2pdf.
      expect(child.hasAttribute('transform')).toBe(false);
      expect(svg.querySelector('clipPath')!.getAttribute('transform')).toBe(
        CLIP_RASTER_INVERSE_TRANSFORM,
      );
      // Geometry is untouched — hoisting never rewrites coordinates.
      expect(child.getAttribute('d')).toBe('M 0 0 L 640 0 L 640 640 Z');
    } finally {
      document.body.removeChild(holder);
    }
  });
});
