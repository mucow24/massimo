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

import { collectUsedFontFaces } from './fonts';
import { FONT_STACK } from '../util/fonts';
import { normalizeTextBaselines } from './pdfText';
import { loadOutlineFonts, outlineAllText } from './pdfGlyphs';

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
  return document.querySelector<SVGSVGElement>('.canvas-host .canvas-pan-layer > svg');
}

// Strip the characters Windows/macOS/Linux collectively reject in filenames
// (< > : " / \ | ? *) and trim surrounding whitespace, so a user-supplied name
// can be folded into a download basename safely. Callers supply their own
// fallback for the all-illegal case, which this returns empty.
export function sanitizeBasename(name: string): string {
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
 * paint the theme background, convert all text to outline paths, and serialize
 * to a standalone SVG string. Throws when there is no content to export.
 *
 * Text is **outlined** rather than the font embedded: the licence permits the
 * font in output files only when the end user can't edit the fonts in the
 * result, so exports carry no font data — every glyph is a `<path>`. This also
 * makes the export self-contained for the PNG and PDF paths (an `<img>`-
 * rasterized SVG and svg2pdf both render the paths directly, with no font to
 * load), so all three exporters share one outlined SVG. See `outlineAllText`.
 *
 * `fitBox` scales the result down to fit within a box (never up) and wins over
 * `pixelScale`. `outlineText: false` leaves text as `<text>` (no font work) —
 * used by the tiny library thumbnail, which rasterizes at 240px where the
 * fallback face reads the same and outlining every glyph would just cost.
 */
export async function buildExportSvg(
  source: SVGSVGElement,
  opts: {
    background: string;
    pixelScale?: number;
    fitBox?: { w: number; h: number };
    outlineText?: boolean;
  },
): Promise<ExportSvg> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('class');

  // Drop editing-only chrome, the viewport-sized background hit rect, and any
  // inline `<foreignObject>` editors (only present mid-edit).
  clone
    .querySelectorAll(`[data-bg],[${EXPORT_EXCLUDE_ATTR}],foreignObject`)
    .forEach((el) => el.remove());

  // Attach offscreen: getBBox, baseline normalization, and glyph outlining all
  // need the clone rendered. Kept mounted through the outline pass, removed in
  // the finally.
  const holder = document.createElement('div');
  holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:0;height:0;');
  holder.appendChild(clone);
  document.body.appendChild(holder);

  let pxW = 0;
  let pxH = 0;
  let svg: string;
  try {
    const box = clone.getBBox();
    if (!(box.width > 0) && !(box.height > 0)) {
      throw new Error('Nothing to export — the canvas is empty.');
    }
    const frameX = box.x - PADDING;
    const frameY = box.y - PADDING;
    const frameW = box.width + PADDING * 2;
    const frameH = box.height + PADDING * 2;

    // viewBox stays at the content frame; width/height are the *pixel* size. For
    // PNG (pixelScale=4) this makes the SVG declare 4× dimensions so the browser
    // rasterizes the vector natively at 4× — scaling the canvas context instead
    // would upscale a 1×-decoded bitmap (blurry, not true 4×).
    //
    // fitBox takes the SMALLER of the two ratios so the bound axis lands on the
    // box and the other stays inside it, and clamps at 1 so a map smaller than
    // the box is never blown up. One scalar for both axes — never letterboxed.
    const scale = opts.fitBox
      ? Math.min(opts.fitBox.w / frameW, opts.fitBox.h / frameH, 1)
      : (opts.pixelScale ?? 1);
    pxW = frameW * scale;
    pxH = frameH * scale;
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', `${frameX} ${frameY} ${frameW} ${frameH}`);
    clone.setAttribute('width', String(pxW));
    clone.setAttribute('height', String(pxH));
    // Only matters when text is left un-outlined (thumbnails); outlined exports
    // carry no <text> to inherit it.
    clone.setAttribute('font-family', FONT_STACK);

    // Background rect sized to the frame, behind all content.
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(frameX));
    bg.setAttribute('y', String(frameY));
    bg.setAttribute('width', String(frameW));
    bg.setAttribute('height', String(frameH));
    bg.setAttribute('fill', opts.background);
    clone.insertBefore(bg, clone.firstChild);

    // Convert every glyph to an outline path (see the header). Baseline-normalize
    // first so getStartPositionOfChar reports the alphabetic baseline the tracer
    // places on. Only the faces actually used are fetched.
    if (opts.outlineText ?? true) {
      normalizeTextBaselines(clone);
      outlineAllText(clone, await loadOutlineFonts(collectUsedFontFaces(clone)));
    }

    svg = new XMLSerializer().serializeToString(clone);
  } finally {
    document.body.removeChild(holder);
  }

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
 * cannot be rendered. Text is deliberately not outlined — at 240px the fallback
 * face reads the same, and tracing every glyph would just cost. The active
 * theme's background bakes in.
 *
 * Throws on an empty canvas (via buildExportSvg), which callers treat as
 * "no thumbnail" rather than a failed save.
 */
export async function captureThumbnail(source: SVGSVGElement, background: string): Promise<string> {
  const { svg, width, height } = await buildExportSvg(source, {
    background,
    fitBox: THUMB_BOX,
    outlineText: false,
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
    // Text is already outlined to paths, so there are no fonts to wait on; decode()
    // still gates on the image being fully ready to paint (more reliable than onload).
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
