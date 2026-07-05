import { describe, it, expect, vi } from 'vitest';
import {
  svgUsesMask,
  rasterizeMaskedImages,
  rasterPixelSize,
  sizeSvgRoot,
  type RasterizeSvg,
} from './pdfMask';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// A magenta square with a circular hole punched out by an alpha mask — the kind
// of graphic svg2pdf drops the mask from (drawing a solid square instead).
const MASKED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
  '<defs><mask id="m1">' +
  '<rect x="0" y="0" width="80" height="80" fill="#fff"/>' +
  '<circle cx="40" cy="40" r="20" fill="#000"/>' +
  '</mask></defs>' +
  '<rect x="0" y="0" width="80" height="80" fill="#c020a0" mask="url(#m1)"/></svg>';

const PLAIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#c020a0"/></svg>';

const dataUri = (markup: string) => `data:image/svg+xml;base64,${btoa(markup)}`;

describe('svgUsesMask', () => {
  it('detects a mask="url(#…)" reference', () => {
    expect(svgUsesMask(MASKED_SVG)).toBe(true);
  });

  it('detects an inline style="mask:url(#…)" reference', () => {
    const styled = PLAIN_SVG.replace('fill="#c020a0"', 'fill="#c020a0" style="mask:url(#m1)"');
    expect(svgUsesMask(styled)).toBe(true);
  });

  it('returns false for a graphic that uses no mask', () => {
    expect(svgUsesMask(PLAIN_SVG)).toBe(false);
  });

  it('is not fooled by the substring "mask" appearing only inside an id', () => {
    const decoy =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="damask" width="4" height="4"/></svg>';
    expect(svgUsesMask(decoy)).toBe(false);
  });
});

describe('rasterizeMaskedImages', () => {
  const makeSvgWithImage = (href: string, ns: 'href' | 'xlink' = 'href') => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('width', '80');
    image.setAttribute('height', '80');
    if (ns === 'xlink') image.setAttributeNS(XLINK_NS, 'href', href);
    else image.setAttribute('href', href);
    svg.appendChild(image);
    return { svg, image };
  };

  it('replaces a masked svg+xml image href with the rasterized PNG', async () => {
    const { svg, image } = makeSvgWithImage(dataUri(MASKED_SVG));
    // Typed with the real signature so mock.calls is a [markup, pxW, pxH] tuple.
    const rasterize = vi.fn<RasterizeSvg>(async () => 'data:image/png;base64,STUBPNG');

    await rasterizeMaskedImages(svg, rasterize);

    expect(image.getAttribute('href')).toBe('data:image/png;base64,STUBPNG');
    // Rasterized from the decoded inner markup, at the image box's pixel size.
    expect(rasterize).toHaveBeenCalledTimes(1);
    const [markup, pxW, pxH] = rasterize.mock.calls[0];
    expect(markup).toContain('mask="url(#m1)"');
    expect(pxW).toBeGreaterThan(80); // supersampled above the 80pt box
    expect(pxH).toBeGreaterThan(80);
  });

  it('decodes URL-encoded svg+xml hrefs too', async () => {
    const { svg, image } = makeSvgWithImage(`data:image/svg+xml,${encodeURIComponent(MASKED_SVG)}`);
    const rasterize = vi.fn(async () => 'data:image/png;base64,STUBPNG');
    await rasterizeMaskedImages(svg, rasterize);
    expect(image.getAttribute('href')).toBe('data:image/png;base64,STUBPNG');
  });

  it('rewrites an xlink:href in place', async () => {
    const { svg, image } = makeSvgWithImage(dataUri(MASKED_SVG), 'xlink');
    const rasterize = vi.fn(async () => 'data:image/png;base64,STUBPNG');
    await rasterizeMaskedImages(svg, rasterize);
    expect(image.getAttributeNS(XLINK_NS, 'href')).toBe('data:image/png;base64,STUBPNG');
  });

  it('leaves a mask-free svg+xml image untouched', async () => {
    const href = dataUri(PLAIN_SVG);
    const { svg, image } = makeSvgWithImage(href);
    const rasterize = vi.fn(async () => 'data:image/png;base64,STUBPNG');
    await rasterizeMaskedImages(svg, rasterize);
    expect(rasterize).not.toHaveBeenCalled();
    expect(image.getAttribute('href')).toBe(href);
  });

  it('leaves a raster (non-svg) image untouched', async () => {
    const href = 'data:image/png;base64,iVBORw0KGgo=';
    const { svg, image } = makeSvgWithImage(href);
    const rasterize = vi.fn(async () => 'data:image/png;base64,STUBPNG');
    await rasterizeMaskedImages(svg, rasterize);
    expect(rasterize).not.toHaveBeenCalled();
    expect(image.getAttribute('href')).toBe(href);
  });

  it('leaves the image as-is (no crash) when rasterizing fails', async () => {
    const href = dataUri(MASKED_SVG);
    const { svg, image } = makeSvgWithImage(href);
    const rasterize = vi.fn(async () => {
      throw new Error('canvas tainted');
    });
    await rasterizeMaskedImages(svg, rasterize);
    expect(image.getAttribute('href')).toBe(href);
  });
});

describe('sizeSvgRoot', () => {
  const rootOf = (out: string) =>
    new DOMParser().parseFromString(out, 'image/svg+xml').documentElement;

  it('injects a viewBox from the intrinsic size when the inner SVG has none, so content scales to fill the raster', () => {
    // width/height but NO viewBox — a common editor/icon export shape. Without a
    // viewBox, overwriting width/height would leave content at 1 user-unit = 1px
    // (tiny, top-left corner). The intrinsic box must become the viewBox.
    const noViewBox =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#c020a0" mask="url(#m)"/></svg>';
    const root = rootOf(sizeSvgRoot(noViewBox, 320, 320));
    expect(root.getAttribute('viewBox')).toBe('0 0 80 80');
    expect(root.getAttribute('width')).toBe('320');
    expect(root.getAttribute('height')).toBe('320');
    expect(root.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('keeps an existing viewBox untouched', () => {
    const withViewBox =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="80" height="80"><rect width="40" height="40" mask="url(#m)"/></svg>';
    const root = rootOf(sizeSvgRoot(withViewBox, 160, 160));
    expect(root.getAttribute('viewBox')).toBe('0 0 40 40');
    expect(root.getAttribute('width')).toBe('160');
    expect(root.getAttribute('height')).toBe('160');
    expect(root.getAttribute('preserveAspectRatio')).toBe('none');
  });
});

describe('rasterPixelSize', () => {
  it('supersamples the box by 4x (288 DPI over 72pt world units)', () => {
    expect(rasterPixelSize(80, 80)).toEqual([320, 320]);
    expect(rasterPixelSize(120, 80)).toEqual([480, 320]);
  });

  it('clamps the larger dimension to MAX_RASTER_DIM while preserving aspect', () => {
    // 5000 x 2500 -> 20000 x 10000 at 4x -> clamp so the max is 4096.
    const [w, h] = rasterPixelSize(5000, 2500);
    expect(Math.max(w, h)).toBe(4096);
    expect(w / h).toBeCloseTo(2, 5); // 2:1 aspect preserved
    expect(h).toBe(2048);
  });
});
