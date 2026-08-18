/**
 * Shared plumbing for the two PDF-export passes that rewrite embedded
 * `<image href="data:image/svg+xml,…">` graphics — `pdfMask` (rasterizes masked
 * images) and `pdfDropShadow` (bakes hard drop-shadows into geometry). Both
 * passes must sniff the `href`/`xlink:href`, decode the base64-or-URL-encoded
 * inner SVG markup, and write a new href back to whichever attribute(s) the
 * element carries. That low-level handling lives here so the two passes can
 * never silently drift on it.
 */

export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Decode a base64 payload to a UTF-8 string (svg markup may carry non-ASCII). */
export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * The decoded inner SVG markup of an `<image>` whose href is an embedded
 * `data:image/svg+xml` URI (base64 or URL-encoded), or null for any other
 * image — raster (`data:image/png…`), an external reference, or a malformed
 * data URI, whether it has no payload at all or one that won't decode — which
 * callers skip. Reads a plain `href` in preference to `xlink:href`, matching
 * how the app emits these images.
 *
 * Every href the app itself mints decodes; a hand-edited doc file or a crafted
 * clipboard payload can carry one that doesn't (a literal `%`, a truncated
 * base64 run). That is one image we can't rewrite, so it reads as "not an
 * embedded SVG" and the pass moves on — the same policy as
 * `rasterizeMaskedImages`, which skips rather than aborting the whole export.
 */
export function decodeEmbeddedSvgImage(image: Element): string | null {
  const href = image.getAttribute('href') ?? image.getAttributeNS(XLINK_NS, 'href') ?? '';
  if (!href.startsWith('data:image/svg+xml')) return null;
  const comma = href.indexOf(',');
  if (comma < 0) return null;
  const isBase64 = href.slice(0, comma).includes(';base64');
  const payload = href.slice(comma + 1);
  try {
    return isBase64 ? fromBase64(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * Write `href` to whichever href attribute(s) the image already carries, so an
 * element using a plain `href`, an `xlink:href`, or both stays consistent after
 * a rewrite. An image with neither is left untouched.
 */
export function setEmbeddedImageHref(image: Element, href: string): void {
  if (image.hasAttribute('href')) image.setAttribute('href', href);
  if (image.hasAttributeNS(XLINK_NS, 'href')) image.setAttributeNS(XLINK_NS, 'href', href);
}
