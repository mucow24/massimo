/**
 * Canvas → image export. Produces a standalone SVG (or a 4× PNG raster of it)
 * of the rendered map, framed to the content bounds with the theme background.
 *
 * The pipeline clones a `<svg>` captured from the canvas rather than
 * re-rendering it: all label and tag geometry is measured against the live DOM,
 * so cloning is the only way to capture the finished layout faithfully.
 * Editing-only chrome (grid, selection highlights, placement ghosts, snap
 * guides, layering overlays, …) is tagged `data-export-exclude` in MapCanvas and
 * stripped here, leaving just the finished map.
 *
 * `source` is a DETACHED SNAPSHOT, not the mounted canvas: the toolbar's
 * captureExportSnapshot applies and reverts the export-only view state (line
 * selection, the lines/stations toggle) around a synchronous clone, so this
 * async pipeline can't pin the live canvas in a state the user didn't ask for.
 * Everything here works off `source`'s content, so a detached node is fine —
 * getBBox gets its own offscreen mount below.
 */

import { buildEmbeddedFontCss, collectUsedFontFaces } from './fonts';
import { FONT_STACK } from '../util/fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** World-unit margin added around the content bounds (also absorbs the stroke
 * overflow `getBBox` ignores). */
const PADDING = 24;
/** Default PNG scale: 4× the natural ("100%") resolution. */
const PNG_SCALE = 4;

/** Attribute marking an element (and its subtree) as editing-only chrome to be
 * stripped from exports. */
export const EXPORT_EXCLUDE_ATTR = 'data-export-exclude';

/** The live map `<svg>` (single canvas), or null if it isn't mounted. */
export function getCanvasSvg(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('.canvas-host > svg');
}

// Strip the characters Windows/macOS/Linux collectively reject in filenames
// (< > : " / \ | ? *) and trim surrounding whitespace, so a map name can be
// folded into a download basename safely.
function sanitizeBasename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim();
}

/**
 * Name-stamped base filename for an export, e.g. "My Subway Map - v23" (clean)
 * or "My Subway Map - v23d" (dirty — edited since that version was saved). The
 * sanitized map name leads (falling back to "map" when it's empty or
 * all-illegal) so successive exports stay grouped.
 *
 * A map with no library version yet — a fresh New map, or a loaded JSON file —
 * has no number to stamp, so it falls back to a date stamp
 * ("My Subway Map - 2026-05-31") to keep exports distinct and sortable. The
 * `dirty` flag is meaningless without a version there, so it's ignored.
 */
export function mapFileBasename(name: string, version: number | null, dirty: boolean): string {
  const base = sanitizeBasename(name) || 'map';
  if (version === null) {
    const date = new Date().toISOString().slice(0, 10);
    return `${base} - ${date}`;
  }
  return `${base} - v${version}${dirty ? 'd' : ''}`;
}

/** Trigger a browser download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ExportSvg {
  svg: string;
  /** Natural ("100%") pixel size of the framed content. */
  width: number;
  height: number;
}

/**
 * Clone the live map SVG, strip editing chrome, reframe to content bounds,
 * paint the theme background, embed the fonts actually used, and serialize to a
 * standalone SVG string. Throws when there is no content to export.
 *
 * `fitBox` scales the result down to fit within a box (never up) and wins over
 * `pixelScale`. `embedFonts: false` skips the `@font-face` payload — hundreds of
 * KB that a thumbnail has no use for.
 */
export async function buildExportSvg(
  source: SVGSVGElement,
  opts: {
    background: string;
    pixelScale?: number;
    fitBox?: { w: number; h: number };
    embedFonts?: boolean;
  },
): Promise<ExportSvg> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('class');

  // Drop editing-only chrome, the viewport-sized background hit rect, and any
  // inline `<foreignObject>` editors (only present mid-edit).
  clone
    .querySelectorAll(`[data-bg],[${EXPORT_EXCLUDE_ATTR}],foreignObject`)
    .forEach((el) => el.remove());

  // Measure content bounds in world units. getBBox needs the element rendered,
  // so attach the clone offscreen for the measurement.
  const holder = document.createElement('div');
  holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:0;height:0;');
  holder.appendChild(clone);
  document.body.appendChild(holder);

  let frameX = 0;
  let frameY = 0;
  let frameW = 0;
  let frameH = 0;
  try {
    const box = clone.getBBox();
    if (!(box.width > 0) && !(box.height > 0)) {
      throw new Error('Nothing to export — the canvas is empty.');
    }
    frameX = box.x - PADDING;
    frameY = box.y - PADDING;
    frameW = box.width + PADDING * 2;
    frameH = box.height + PADDING * 2;
  } finally {
    document.body.removeChild(holder);
  }

  // viewBox stays at the content frame; width/height are the *pixel* size. For
  // PNG (pixelScale=4) this makes the SVG declare 4× dimensions so the browser
  // rasterizes the vector natively at 4× — scaling the canvas context instead
  // would upscale a 1×-decoded bitmap (blurry, not true 4×).
  //
  // fitBox takes the SMALLER of the two ratios so the bound axis lands on the
  // box and the other stays inside it, and clamps at 1 so a map smaller than the
  // box is never blown up. One scalar for both axes — never letterboxed.
  const scale = opts.fitBox
    ? Math.min(opts.fitBox.w / frameW, opts.fitBox.h / frameH, 1)
    : (opts.pixelScale ?? 1);
  const pxW = frameW * scale;
  const pxH = frameH * scale;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('viewBox', `${frameX} ${frameY} ${frameW} ${frameH}`);
  clone.setAttribute('width', String(pxW));
  clone.setAttribute('height', String(pxH));
  // Text inherits its family from this root so the embedded @font-face applies.
  clone.setAttribute('font-family', FONT_STACK);

  // Background rect sized to the frame, behind all content.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(frameX));
  bg.setAttribute('y', String(frameY));
  bg.setAttribute('width', String(frameW));
  bg.setAttribute('height', String(frameH));
  bg.setAttribute('fill', opts.background);
  clone.insertBefore(bg, clone.firstChild);

  // Embed only the font faces actually used by the surviving text.
  const css =
    (opts.embedFonts ?? true) ? await buildEmbeddedFontCss(collectUsedFontFaces(clone)) : '';
  if (css) {
    let defs = clone.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      clone.insertBefore(defs, clone.firstChild);
    }
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = css;
    defs.appendChild(style);
  }

  const svg = new XMLSerializer().serializeToString(clone);
  return { svg, width: pxW, height: pxH };
}

/** Export the current map as a downloaded SVG file named `${basename}.svg`. */
export async function exportCanvasSvg(
  source: SVGSVGElement,
  background: string,
  basename: string,
): Promise<void> {
  const { svg } = await buildExportSvg(source, { background });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${basename}.svg`);
}

/** Largest a library thumbnail may be; the map fits inside, keeping its aspect. */
export const THUMB_BOX = { w: 240, h: 180 };

/**
 * A small PNG data URI of the current map, for the library's version list.
 *
 * Captured at save time because that is the only time it is possible: MapCanvas
 * takes no props and reads singleton stores, so a document that isn't on screen
 * cannot be rendered. Fonts are deliberately not embedded — ~347 KB of base64
 * for a 240px-wide picture, where the fallback stack looks the same. The active
 * theme's background bakes in.
 *
 * Throws on an empty canvas (via buildExportSvg), which callers treat as
 * "no thumbnail" rather than a failed save.
 */
export async function captureThumbnail(source: SVGSVGElement, background: string): Promise<string> {
  const { svg, width, height } = await buildExportSvg(source, {
    background,
    fitBox: THUMB_BOX,
    embedFonts: false,
  });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Export the current map as a downloaded PNG file rendered at `scale`× size. */
export async function exportCanvasPng(
  source: SVGSVGElement,
  background: string,
  basename: string,
  scale = PNG_SCALE,
): Promise<void> {
  // pixelScale bakes the 4× into the SVG's own width/height (viewBox unchanged),
  // so `width`/`height` here are already the target pixel dimensions and the
  // vector rasterizes crisply at full resolution — no context scaling needed.
  const { svg, width, height } = await buildExportSvg(source, { background, pixelScale: scale });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    // decode() resolves only once the image (incl. its embedded data-URI fonts)
    // is fully ready to paint — more reliable than onload for font fidelity.
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    ctx.drawImage(img, 0, 0);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!pngBlob) throw new Error('PNG encoding failed.');
    downloadBlob(pngBlob, `${basename}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
