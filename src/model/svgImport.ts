// Pure helpers for importing an image file (.svg, or a png/jpeg raster): read
// its intrinsic size for the initial on-canvas dimensions, and encode it as an
// opaque data URI.

const FALLBACK_SIZE = { width: 200, height: 200 } as const;

/**
 * Data-URI prefixes an SvgImage href may carry: inline svg markup, or the two
 * raster formats we import (png/jpeg — the ones jsPDF can embed, so PDF export
 * keeps working). Shared by the import path and the clipboard security guard
 * so the two can never drift.
 */
const IMAGE_HREF_PREFIXES = ['data:image/svg+xml', 'data:image/png', 'data:image/jpeg'] as const;

/** The raster mime types the import path accepts (see IMAGE_HREF_PREFIXES). */
export const RASTER_IMPORT_MIMES = ['image/png', 'image/jpeg'] as const;

/**
 * The largest image file we will pull into a map. An imported image lives in
 * the document as an inline data URI, so it is re-serialized into localStorage
 * on every edit (a ~5MB origin quota, and base64 inflates the bytes by a third
 * on the way in) and travels inside every exported file. The ceiling keeps an
 * arbitrary file from bloating the doc without bound — but it no longer
 * guarantees the doc fits the quota: a near-ceiling import base64-encodes past
 * ~5MB on its own, and persistence then falls back to the swallow-and-toast
 * path in the store. The gate is on BYTES, not just on the mime type.
 */
export const MAX_IMAGE_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Whether a chosen image file is too big to live inside a document. Callers
 * check it before reading the file so the SVG branch (which has no decode step
 * of its own) is covered too; `rasterFileToImage` applies it again as the
 * backstop no raster import can bypass.
 */
export function isImageFileTooLarge(file: { size: number }): boolean {
  return file.size > MAX_IMAGE_IMPORT_BYTES;
}

/**
 * Whether an SvgImage href is one of our allowed inline data URIs. Anything
 * else — a remote URL, a script URI, a non-image data URI — is rejected to
 * preserve the opaque-sandbox model.
 */
export function isAllowedImageHref(href: string): boolean {
  return IMAGE_HREF_PREFIXES.some((p) => href.startsWith(p));
}

// Parse a length attribute that is unitless or px (e.g. "320", "320px"); any
// other unit (cm, %, em) returns null so the caller falls through to viewBox.
function parseLenPx(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The intrinsic pixel size of an SVG document, used for its initial on-canvas
 * size + aspect. Priority: explicit width&height (unitless/px, both > 0) →
 * viewBox width/height → a 200×200 fallback when neither is usable.
 */
export function parseSvgIntrinsicSize(text: string): { width: number; height: number } {
  try {
    const doc = new globalThis.DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return { ...FALLBACK_SIZE };
    const w = parseLenPx(svg.getAttribute('width'));
    const h = parseLenPx(svg.getAttribute('height'));
    if (w && h) return { width: w, height: h };
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (
        parts.length === 4 &&
        parts.every((n) => Number.isFinite(n)) &&
        parts[2] > 0 &&
        parts[3] > 0
      ) {
        return { width: parts[2], height: parts[3] };
      }
    }
    return { ...FALLBACK_SIZE };
  } catch {
    return { ...FALLBACK_SIZE };
  }
}

/** Base64-encode raw bytes as a `data:<mime>;base64,…` URI. */
export function bytesToDataUri(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${mime};base64,${globalThis.btoa(binary)}`;
}

/**
 * Encode SVG source text as a `data:image/svg+xml;base64,…` URI. Encodes to
 * UTF-8 bytes before base64 so non-Latin1 content (e.g. CJK labels) doesn't
 * throw — the naive `btoa(text)` form does.
 */
export function svgTextToDataUri(text: string): string {
  return bytesToDataUri('image/svg+xml', new globalThis.TextEncoder().encode(text));
}

/**
 * Read a raster image file (png/jpeg) as a placement payload: the file bytes
 * as an opaque data URI plus the decoded pixel size. Returns null for a
 * disallowed mime, a file over the import ceiling, or one that fails to decode
 * (corrupt/not an image) — unlike svg, a raster with no readable size would
 * render as nothing at all, so the caller skips placement entirely. NOT pure
 * (decodes via `createImageBitmap`), which is why it lives behind the pure
 * helpers above.
 */
export async function rasterFileToImage(
  file: File,
): Promise<{ href: string; width: number; height: number } | null> {
  if (!(RASTER_IMPORT_MIMES as readonly string[]).includes(file.type)) return null;
  // Before the decode: an oversized file is refused outright, never rasterized
  // and never base64-expanded into a doc that then cannot be persisted.
  if (isImageFileTooLarge(file)) return null;
  let width: number;
  let height: number;
  try {
    const bmp = await globalThis.createImageBitmap(file);
    ({ width, height } = bmp);
    bmp.close();
  } catch {
    return null;
  }
  const href = bytesToDataUri(file.type, new Uint8Array(await file.arrayBuffer()));
  return { href, width, height };
}
