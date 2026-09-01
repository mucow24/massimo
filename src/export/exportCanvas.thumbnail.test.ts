import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureThumbnail } from './exportCanvas';
import { outlineAllText } from './pdfGlyphs';
import { stubGetBBox } from '../test/interaction';

// The real tracer needs getStartPositionOfChar and font fetches, neither of
// which jsdom has; the wiring under test is that captureThumbnail ASKS for the
// outline pass, not what the pass draws.
vi.mock('./pdfGlyphs', () => ({
  loadOutlineFonts: vi.fn(async () => new Map()),
  outlineAllText: vi.fn(),
}));

const SVG_NS = 'http://www.w3.org/2000/svg';

const makeSourceSvg = (innerHTML: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.innerHTML = innerHTML;
  return svg;
};

// jsdom has no blob URLs, no Image.decode, and no 2D canvas — stub the whole
// rasterize leg and record the canvas size toDataURL was called at.
let rasterizedAt: { w: number; h: number } | null = null;
let restoreBBox: (() => void) | null = null;
const originals: Array<() => void> = [];

const stub = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]) => {
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const prev = obj[key];
  obj[key] = value;
  originals.push(() => {
    if (had) obj[key] = prev;
    else delete obj[key];
  });
};

beforeEach(() => {
  rasterizedAt = null;
  stub(URL, 'createObjectURL', vi.fn(() => 'blob:stub') as typeof URL.createObjectURL);
  stub(URL, 'revokeObjectURL', vi.fn() as typeof URL.revokeObjectURL);
  stub(HTMLImageElement.prototype, 'decode', vi.fn(async () => {}) as HTMLImageElement['decode']);
  stub(
    HTMLCanvasElement.prototype,
    'getContext',
    vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'],
  );
  stub(HTMLCanvasElement.prototype, 'toDataURL', function (this: HTMLCanvasElement) {
    rasterizedAt = { w: this.width, h: this.height };
    return 'data:image/png;base64,stub';
  } as HTMLCanvasElement['toDataURL']);
});

afterEach(() => {
  while (originals.length) originals.pop()!();
  restoreBBox?.();
  restoreBBox = null;
  vi.mocked(outlineAllText).mockClear();
});

describe('captureThumbnail', () => {
  it('outlines text and rasterizes at the 480×360 thumbnail box', async () => {
    // frame = bbox + 2·PADDING(24) = 960×720, exactly 2× the box → scale 0.5.
    restoreBBox = stubGetBBox({ x: 0, y: 0, width: 912, height: 672 });
    const svg = makeSourceSvg('<text x="0" y="0">Canal St</text>');

    const uri = await captureThumbnail(svg, '#fff');

    // Outlined, not left as <text>: inside the rasterizer's <img> the app's
    // webfonts don't exist, so un-outlined labels would render in Arial.
    expect(outlineAllText).toHaveBeenCalledTimes(1);
    expect(rasterizedAt).toEqual({ w: 480, h: 360 });
    expect(uri).toBe('data:image/png;base64,stub');
  });
});
