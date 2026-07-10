/**
 * Rasterize mask-using embedded SVG graphics for the PDF export.
 *
 * Map graphics are embedded as `<image href="data:image/svg+xml,…">`. svg2pdf
 * renders such an image by re-parsing it as vectors through a node tree that has
 * NO `<mask>` support: `<mask>`/`<defs>` become no-op void nodes and the
 * `mask="url(#…)"` attribute is never read, so a masked shape is drawn at full
 * opacity — the mask silently vanishes from the PDF (it renders fine on screen,
 * where the browser's native `<image>` applies it).
 *
 * A mask has no vector equivalent svg2pdf understands (unlike a hard drop-shadow,
 * which bakes to geometry — see pdfDropShadow), so the only faithful fix is to
 * rasterize just those graphics through the browser (which applies the mask) and
 * hand svg2pdf a PNG it embeds verbatim. Non-masked graphics stay vector.
 */

import { parseSvgIntrinsicSize, svgTextToDataUri } from '../model/svgImport';
import { decodeEmbeddedSvgImage, setEmbeddedImageHref } from './embeddedSvg';

// world unit = 1 PDF point = 1/72 in, so 288 ≈ 4× supersample → crisp in print
// without unbounded canvases; MAX_RASTER_DIM clamps a large graphic's memory.
const PDF_RASTER_DPI = 288;
const MAX_RASTER_DIM = 4096;

/** Rasterize inner SVG markup to a PNG data URI at the given pixel size. */
export type RasterizeSvg = (markup: string, pxWidth: number, pxHeight: number) => Promise<string>;

/** True when an element applies a mask via `style="mask:…"` / `mask-image:…`. */
function styleUsesMask(el: Element): boolean {
  return /(?:^|[;{\s])mask(?:-image)?\s*:/.test(el.getAttribute('style') ?? '');
}

/**
 * True when the inner SVG markup references a mask — either the `mask` attribute
 * (`mask="url(#…)"`, how graphic editors emit it) or an inline `mask:` style.
 * A referenced mask is exactly what svg2pdf silently drops. A `<mask>` def that
 * is never referenced isn't detected (nothing to lose). `<style>`-block CSS
 * masks aren't detected (vanishingly rare in exported graphics).
 */
export function svgUsesMask(markup: string): boolean {
  if (!markup.includes('mask')) return false; // fast path: no such substring at all
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  if (root.hasAttribute('mask') || root.querySelector('[mask]')) return true;
  if (styleUsesMask(root)) return true;
  for (const el of root.querySelectorAll('[style]')) {
    if (styleUsesMask(el)) return true;
  }
  return false;
}

/** Target PNG pixel size for a `width`×`height` (world-unit) image box. */
export function rasterPixelSize(width: number, height: number): [number, number] {
  const scale = PDF_RASTER_DPI / 72;
  let pxW = Math.max(1, Math.round(width * scale));
  let pxH = Math.max(1, Math.round(height * scale));
  const over = Math.max(pxW, pxH) / MAX_RASTER_DIM;
  if (over > 1) {
    pxW = Math.max(1, Math.round(pxW / over));
    pxH = Math.max(1, Math.round(pxH / over));
  }
  return [pxW, pxH];
}

/**
 * Force an explicit pixel size and `preserveAspectRatio="none"` on the SVG root
 * so the browser rasterizes at the target resolution and stretches the graphic
 * to fill the box — matching how the on-screen `<image preserveAspectRatio="none">`
 * draws it.
 *
 * If the root has no `viewBox`, its content has no user-space→viewport mapping,
 * so overwriting width/height alone would NOT scale it (`preserveAspectRatio` is
 * inert without a viewBox) — the graphic would rasterize at native size in the
 * top-left corner. Inject a viewBox equal to the intrinsic box so the content
 * stretches to fill, matching the screen. (An inner SVG whose width/height aspect
 * differs from its viewBox aspect and relies on its own meet/slice letterboxing
 * will fill rather than letterbox here — an accepted minor divergence; such
 * inputs are rare and the outer stretch already discards aspect.)
 */
export function sizeSvgRoot(markup: string, pxWidth: number, pxHeight: number): string {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  if (!root.hasAttribute('viewBox')) {
    const { width, height } = parseSvgIntrinsicSize(markup);
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  root.setAttribute('width', String(pxWidth));
  root.setAttribute('height', String(pxHeight));
  root.setAttribute('preserveAspectRatio', 'none');
  return new XMLSerializer().serializeToString(root);
}

/** Browser rasterizer: draw the inner SVG onto a canvas and read back a PNG. */
async function rasterizeSvgToPng(
  markup: string,
  pxWidth: number,
  pxHeight: number,
): Promise<string> {
  const url = svgTextToDataUri(sizeSvgRoot(markup, pxWidth, pxHeight));
  const img = new Image();
  img.width = pxWidth;
  img.height = pxHeight;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('embedded SVG failed to load for rasterization'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context for rasterization');
  ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
  return canvas.toDataURL('image/png');
}

/**
 * Walk the export SVG and rasterize every embedded `data:image/svg+xml` image
 * that uses a mask, rewriting its href to the PNG in place. Non-masked SVGs and
 * raster images are left untouched. If rasterization fails (e.g. the canvas is
 * tainted by an external reference), the image is left as-is with a warning
 * rather than aborting the whole export. Runs BEFORE `bakeImageDropShadows`,
 * which then skips these images (their href is now PNG, not svg+xml).
 */
export async function rasterizeMaskedImages(
  svg: SVGSVGElement,
  rasterize: RasterizeSvg = rasterizeSvgToPng,
): Promise<void> {
  for (const image of svg.querySelectorAll('image')) {
    const markup = decodeEmbeddedSvgImage(image);
    if (markup === null) continue;
    if (!svgUsesMask(markup)) continue;

    const width = parseFloat(image.getAttribute('width') ?? '0');
    const height = parseFloat(image.getAttribute('height') ?? '0');
    if (!(width > 0) || !(height > 0)) continue;

    let png: string;
    try {
      png = await rasterize(markup, ...rasterPixelSize(width, height));
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn(
          `PDF export: could not rasterize a masked image; it will export without its mask.\n${e}`,
        );
      }
      continue;
    }

    setEmbeddedImageHref(image, png);
  }
}
