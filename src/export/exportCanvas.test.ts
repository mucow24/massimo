import { describe, it, expect, afterEach } from 'vitest';
import { buildExportSvg, mapFileBasename } from './exportCanvas';
import { stubGetBBox } from '../test/interaction';

const SVG_NS = 'http://www.w3.org/2000/svg';

const makeSourceSvg = (innerHTML: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'canvas-svg');
  svg.innerHTML = innerHTML;
  return svg;
};

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('mapFileBasename', () => {
  it('stamps a clean version as "${name} - v${version}"', () => {
    expect(mapFileBasename('Foo map', 23, false)).toBe('Foo map - v23');
  });

  it('appends "d" to a dirty version', () => {
    expect(mapFileBasename('Foo map', 23, true)).toBe('Foo map - v23d');
  });

  it('falls back to a date stamp when there is no version', () => {
    // A fresh New map or a loaded JSON file has no library version.
    expect(mapFileBasename('My Subway Map', null, false)).toMatch(
      /^My Subway Map - \d{4}-\d{2}-\d{2}$/,
    );
    // The dirty flag is irrelevant without a version — no trailing "d".
    expect(mapFileBasename('My Subway Map', null, true)).toMatch(
      /^My Subway Map - \d{4}-\d{2}-\d{2}$/,
    );
  });

  it('strips characters that are illegal in filenames', () => {
    // Windows/macOS/Linux collectively reject < > : " / \ | ? * in filenames.
    expect(mapFileBasename('A/B:C*?"<>|\\', 7, false)).toBe('ABC - v7');
  });

  it('falls back to "map" when the name is empty or all-illegal', () => {
    expect(mapFileBasename('   ', 7, false)).toBe('map - v7');
    expect(mapFileBasename('/\\:', 7, true)).toBe('map - v7d');
  });
});

describe('buildExportSvg', () => {
  it('rejects with an "empty" error only when BOTH content dimensions are zero', async () => {
    restore = stubGetBBox({ x: 0, y: 0, width: 0, height: 0 });
    const svg = makeSourceSvg('<circle cx="0" cy="0" r="5"></circle>');
    await expect(buildExportSvg(svg, { background: '#fff' })).rejects.toThrow(/empty/i);
  });

  it('restates the font-feature-settings as a STYLE, the only form that shapes the clone', async () => {
    // font-feature-settings is not an SVG presentation attribute, so the
    // attribute form silently does nothing and the detached clone shapes with
    // every feature on — disagreeing with the screen it was cloned from and with
    // the tracer that measures its pen positions. It is also what keeps `calt`
    // alive under the label tracking the clone inherits, where
    // `font-variant-ligatures` would be dropped.
    restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 50 });
    const svg = makeSourceSvg('<text x="0" y="0">12:30</text>');
    const { svg: out } = await buildExportSvg(svg, { background: '#fff', outlineText: false });
    // XMLSerializer escapes the quotes inside the style attribute to &quot;.
    const unescaped = out.replace(/&quot;/g, '"');
    expect(unescaped).toMatch(/font-feature-settings:\s*"calt"\s*1/);
    expect(unescaped).toMatch(/"liga"\s*0/);
  });

  it('does NOT reject a degenerate-but-nonzero box (one dimension zero)', async () => {
    // A zero-height-but-positive-width strip is still exportable (e.g. a single
    // horizontal line). The empty guard is an AND, not an OR.
    restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 0 });
    const svg = makeSourceSvg('<line x1="0" y1="0" x2="100" y2="0"></line>');
    await expect(buildExportSvg(svg, { background: '#fff' })).resolves.toBeTruthy();
  });

  it('strips export chrome (data-bg, data-export-exclude, foreignObject) but keeps real content', async () => {
    restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 100 });
    const svg = makeSourceSvg(
      [
        '<rect data-bg="true" x="0" y="0" width="9" height="9"></rect>',
        '<g data-export-exclude="true"><line x1="0" y1="0" x2="1" y2="1"></line></g>',
        '<foreignObject><div>editor</div></foreignObject>',
        '<circle class="keep-me" cx="3" cy="4" r="5"></circle>',
      ].join(''),
    );
    const { svg: out } = await buildExportSvg(svg, { background: '#fff' });
    expect(out).toContain('keep-me');
    expect(out).not.toContain('data-export-exclude');
    expect(out).not.toContain('data-bg');
    expect(out).not.toContain('foreignObject');
  });

  it('keeps an svg-image <image> body but strips its selection handles', async () => {
    restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 100 });
    const svg = makeSourceSvg(
      [
        '<g data-svg-image-id="i0" transform="translate(0 0) rotate(0)">',
        '<image href="data:image/svg+xml;base64,PHN2Zy8+" x="-50" y="-30" width="100" height="60"></image>',
        '</g>',
        '<g data-export-exclude="1"><rect data-svg-image-handle="nw" x="0" y="0" width="10" height="10"></rect></g>',
      ].join(''),
    );
    const { svg: out } = await buildExportSvg(svg, { background: '#fff' });
    expect(out).toContain('<image');
    expect(out).toContain('data:image/svg+xml;base64,PHN2Zy8+');
    expect(out).not.toContain('data-svg-image-handle');
    expect(out).not.toContain('data-export-exclude');
  });

  it('frames to bounds + PADDING and scales width/height by pixelScale', async () => {
    restore = stubGetBBox({ x: 10, y: 20, width: 100, height: 80 });
    const svg = makeSourceSvg('<circle cx="50" cy="50" r="5"></circle>');
    const {
      svg: out,
      width,
      height,
    } = await buildExportSvg(svg, {
      background: '#fff',
      pixelScale: 2,
    });
    // PADDING=24: frame = (10-24, 20-24, 100+48, 80+48) = (-14, -4, 148, 128).
    // Pixel size = frame * pixelScale.
    expect(width).toBe(296);
    expect(height).toBe(256);
    expect(out).toContain('viewBox="-14 -4 148 128"');
  });

  // PADDING=24 adds 48 to each axis, so the bbox below is the frame minus 48.
  // The assertion is on the returned pixel size only: :116-117 applies ONE
  // uniform scalar to both axes, so letterboxing is architecturally impossible
  // and an aspect-ratio assertion could never fail.
  it.each([
    {
      name: 'fits an oversized frame to the box',
      box: { width: 432, height: 312 },
      w: 240,
      h: 180,
    },
    // min-not-max: taking the larger ratio here would give 720×180 and overflow.
    { name: 'fits a wide frame by its bound axis', box: { width: 432, height: 72 }, w: 240, h: 60 },
    // No upscaling — a small map stays its own size rather than blurring up.
    { name: 'leaves a frame smaller than the box', box: { width: 52, height: 2 }, w: 100, h: 50 },
  ])('fitBox $name', async ({ box, w, h }) => {
    restore = stubGetBBox({ x: 0, y: 0, ...box });
    const svg = makeSourceSvg('<circle cx="5" cy="5" r="1"></circle>');
    const out = await buildExportSvg(svg, {
      background: '#fff',
      fitBox: { w: 240, h: 180 },
    });
    expect([out.width, out.height]).toEqual([w, h]);
  });

  // Fonts are never embedded now: text is outlined to <path> at export. The
  // glyph→path tracing needs getStartPositionOfChar, which jsdom lacks, so it's
  // covered by e2e; here we pin the format-level contract that survives jsdom.
  describe('text outlining', () => {
    it('leaves text as <text> when outlineText is false (thumbnail path)', async () => {
      restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 80 });
      const svg = makeSourceSvg('<text x="0" y="0">Canal St</text>');
      const { svg: out } = await buildExportSvg(svg, { background: '#fff', outlineText: false });
      expect(out).toContain('Canal St');
      expect(out).toContain('<text');
      expect(out).not.toContain('@font-face');
    });

    it('never writes an @font-face / <style> block (no font is ever embedded)', async () => {
      restore = stubGetBBox({ x: 0, y: 0, width: 100, height: 80 });
      const svg = makeSourceSvg('<circle cx="1" cy="1" r="1"></circle>');
      const { svg: out } = await buildExportSvg(svg, { background: '#fff' });
      expect(out).not.toContain('@font-face');
      expect(out).not.toContain('<style');
    });
  });

  it('fitBox wins over pixelScale', async () => {
    restore = stubGetBBox({ x: 0, y: 0, width: 432, height: 312 });
    const svg = makeSourceSvg('<circle cx="5" cy="5" r="1"></circle>');
    const out = await buildExportSvg(svg, {
      background: '#fff',
      pixelScale: 4,
      fitBox: { w: 240, h: 180 },
    });
    expect([out.width, out.height]).toEqual([240, 180]);
  });

  it('inserts the background rect before the content, sized to the frame, filled with the background color', async () => {
    restore = stubGetBBox({ x: 10, y: 20, width: 100, height: 80 });
    const svg = makeSourceSvg('<circle cx="50" cy="50" r="5"></circle>');
    const { svg: out } = await buildExportSvg(svg, { background: '#abcdef' });

    // The bg rect carries the frame geometry and the background fill, and is
    // serialized BEFORE the content (the circle) so it paints behind it.
    const rectMatch = out.match(
      /<rect\b[^>]*\bwidth="148"[^>]*\bheight="128"[^>]*\bfill="#abcdef"[^>]*\/?>/,
    );
    expect(rectMatch).not.toBeNull();
    const rect = rectMatch![0];
    expect(rect).toContain('x="-14"');
    expect(rect).toContain('y="-4"');
    // Background rect precedes the circle content in the serialized output.
    const rectIdx = out.indexOf(rect);
    const circleIdx = out.indexOf('<circle');
    expect(rectIdx).toBeGreaterThanOrEqual(0);
    expect(circleIdx).toBeGreaterThan(rectIdx);
  });
});
