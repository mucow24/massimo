import { describe, it, expect, vi, afterEach } from 'vitest';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { hoistClipPathTransforms } from './pdfClip';
import { CLIP_RASTER_INVERSE_TRANSFORM, CLIP_RASTER_SCALE } from '../components/canvas/clipRaster';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Parse SVG markup the way the export pipeline does (real SVG-namespaced nodes,
 * not the HTML-parsed elements `innerHTML` yields in jsdom). */
function svgWith(inner: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" width="100" height="100">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGSVGElement;
}

afterEach(() => vi.restoreAllMocks());

describe('hoistClipPathTransforms', () => {
  it('moves a child transform onto the clipPath, leaving geometry untouched', () => {
    const svg = svgWith(
      '<clipPath id="c"><path transform="scale(0.5)" d="M 0 0 L 640 0 Z"/></clipPath>',
    );
    hoistClipPathTransforms(svg);
    const clip = svg.querySelector('clipPath')!;
    expect(clip.getAttribute('transform')).toBe('scale(0.5)');
    const path = clip.firstElementChild!;
    expect(path.hasAttribute('transform')).toBe(false);
    // Coordinates are never rewritten — that is the point of hoisting.
    expect(path.getAttribute('d')).toBe('M 0 0 L 640 0 Z');
  });

  it('composes with a transform the clipPath already carries, preserving order', () => {
    // An SVG transform list applies left to right, so the child's transform must
    // land AFTER the clipPath's own to reproduce what the child saw.
    const svg = svgWith(
      '<clipPath id="c" transform="translate(5 7)"><path transform="scale(0.5)" d="M 0 0 Z"/></clipPath>',
    );
    hoistClipPathTransforms(svg);
    expect(svg.querySelector('clipPath')!.getAttribute('transform')).toBe(
      'translate(5 7) scale(0.5)',
    );
  });

  it('hoists non-scale and non-path children too (geometry is never parsed)', () => {
    // Coordinate rewriting could not do this: rotate on a <rect>.
    const svg = svgWith(
      '<clipPath id="c"><rect transform="rotate(30)" x="1" y="2" width="3" height="4"/></clipPath>',
    );
    hoistClipPathTransforms(svg);
    expect(svg.querySelector('clipPath')!.getAttribute('transform')).toBe('rotate(30)');
    expect(svg.querySelector('rect')!.hasAttribute('transform')).toBe(false);
  });

  it('handles the clip-raster transform the on-screen code actually emits', () => {
    // Ties this pass to its producer: if clipRaster.ts changes the workaround,
    // this fails rather than silently re-breaking the PDF.
    const svg = svgWith(
      `<clipPath id="c"><path transform="${CLIP_RASTER_INVERSE_TRANSFORM}" d="M 0 0 Z"/></clipPath>`,
    );
    hoistClipPathTransforms(svg);
    expect(svg.querySelector('clipPath')!.getAttribute('transform')).toBe(
      CLIP_RASTER_INVERSE_TRANSFORM,
    );
    expect(svg.querySelector('path')!.hasAttribute('transform')).toBe(false);
    expect(CLIP_RASTER_INVERSE_TRANSFORM).toBe(`scale(${1 / CLIP_RASTER_SCALE})`);
  });

  it('is a no-op when no child carries a transform', () => {
    const svg = svgWith('<clipPath id="c"><path d="M 1 2 L 3 4 Z"/></clipPath>');
    hoistClipPathTransforms(svg);
    const clip = svg.querySelector('clipPath')!;
    expect(clip.hasAttribute('transform')).toBe(false);
    expect(clip.firstElementChild!.getAttribute('d')).toBe('M 1 2 L 3 4 Z');
  });

  it('warns instead of silently mis-clipping when children disagree', () => {
    // Hoisting one child's transform would move the sibling that lacks it, so
    // the clip is left alone — but it still compounds on reuse, so it must be loud.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = svgWith(
      '<clipPath id="mixed"><path transform="scale(0.5)" d="M 0 0 Z"/><path d="M 1 1 Z"/></clipPath>',
    );
    hoistClipPathTransforms(svg);
    const clip = svg.querySelector('clipPath')!;
    expect(clip.hasAttribute('transform')).toBe(false);
    expect(clip.firstElementChild!.getAttribute('transform')).toBe('scale(0.5)');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('mixed');
  });
});

/**
 * The behavioural guard. svg2pdf memoizes each node's parsed path and
 * `Path.transform` mutates it in place, so a transform on a clipPath CHILD is
 * re-applied once per referencing element and the clip shrinks geometrically
 * (1×, 1/64, 1/4096 …). These assert against the real converter, so they go red
 * if the hoist is removed — the pure DOM tests above cannot catch that.
 */
describe('svg2pdf: a clipPath reused by several elements', () => {
  const CLIP_BODY = `<path transform="${CLIP_RASTER_INVERSE_TRANSFORM}" d="M 0 0 L 640 0 L 640 640 L 0 640 Z"/>`;
  // Clipped content is a <circle> so it emits bezier curves, never the
  // `0. 0. m / X 0. l` square the clip regions below are matched by.
  const THREE_USERS = ['#ff0000', '#00ff00', '#0000ff']
    .map((f) => `<g clip-path="url(#c)"><circle cx="5" cy="5" r="50" fill="${f}"/></g>`)
    .join('');

  /** Each emitted clip region as [ctm, x-extent], in document order. */
  async function clipRegions(hoist: boolean): Promise<string[]> {
    const svg = svgWith(
      `<defs><clipPath id="c" clipPathUnits="userSpaceOnUse">${CLIP_BODY}</clipPath></defs>${THREE_USERS}`,
    );
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-99999px;top:0';
    holder.appendChild(svg);
    document.body.appendChild(holder);
    try {
      if (hoist) hoistClipPathTransforms(svg);
      const doc = new jsPDF({ unit: 'pt', format: [100, 100], compress: false });
      await svg2pdf(svg, doc, { x: 0, y: 0, width: 100, height: 100 });
      const out = doc.output();
      return [
        ...out.matchAll(
          /([-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+) cm\n0\. 0\. m\n([\d.]+) 0\. l/g,
        ),
      ].map((m) => `${m[1]} | ${m[2]}`);
    } finally {
      document.body.removeChild(holder);
    }
  }

  it('mis-clips every reference after the first WITHOUT the hoist (the bug)', async () => {
    const regions = await clipRegions(false);
    expect(regions).toHaveLength(3);
    // Each successive clip is 1/CLIP_RASTER_SCALE of the one before it.
    expect(new Set(regions).size).toBe(3);
    const extent = (r: string) => parseFloat(r.split('|')[1]);
    expect(extent(regions[1])).toBeCloseTo(extent(regions[0]) / CLIP_RASTER_SCALE, 6);
    expect(extent(regions[2])).toBeCloseTo(extent(regions[1]) / CLIP_RASTER_SCALE, 6);
  });

  it('clips all three references identically WITH the hoist', async () => {
    const regions = await clipRegions(true);
    expect(regions).toHaveLength(3);
    expect(new Set(regions).size).toBe(1);
  });

  it('the hoisted clip covers the same region the first (correct) reference did', async () => {
    // Stability is not enough — the region must still be the intended one. The
    // un-hoisted FIRST reference is known-correct, so compare against it.
    const before = await clipRegions(false);
    const after = await clipRegions(true);
    const effective = (r: string) => {
      const [ctm, ext] = r.split('|');
      return parseFloat(ctm.trim().split(/\s+/)[0]) * parseFloat(ext);
    };
    expect(effective(after[0])).toBeCloseTo(effective(before[0]), 6);
  });
});
