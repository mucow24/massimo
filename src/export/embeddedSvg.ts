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
 * embedded SVG" and the pass moves on. Skipping alone does NOT save the
 * export, though — svg2pdf runs the identical decode downstream and dies on
 * the same href — which is why `dropUndecodableImages` below removes such
 * images before svg2pdf ever sees them.
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
 * Remove every `<image>` whose `data:` href svg2pdf cannot survive, returning
 * how many were dropped. svg2pdf decodes each data URI itself — atob /
 * decodeURIComponent, and a mime split that throws on anything but `image/*` —
 * and it does so OUTSIDE its internal try, so a payload that won't decode
 * throws out of the render and takes the whole PDF with it. The passes above
 * merely SKIPPING such an image is not enough: the skip leaves the href in the
 * markup svg2pdf is handed next. Judged with the same rules svg2pdf applies,
 * so exactly the images it would die on are the ones removed; healthy data
 * URIs and external hrefs (the import allow-list's business) pass through.
 */
export function dropUndecodableImages(svg: SVGSVGElement): number {
  let dropped = 0;
  for (const image of Array.from(svg.querySelectorAll('image'))) {
    const href = image.getAttribute('href') ?? image.getAttributeNS(XLINK_NS, 'href') ?? '';
    if (!href.startsWith('data:')) continue;
    if (!svg2pdfCanDecode(href)) {
      image.remove();
      dropped++;
    }
  }
  return dropped;
}

function svg2pdfCanDecode(href: string): boolean {
  const comma = href.indexOf(',');
  // No payload separator: svg2pdf's data-URI regex misses and it falls back to
  // fetch()ing the string as a URL, which rejects — same unhandled death.
  if (comma < 0) return false;
  const head = href.slice(5, comma); // between "data:" and the comma
  const mime = head.split(';')[0];
  if (!mime.startsWith('image/')) return false;
  const payload = href.slice(comma + 1);
  try {
    if (head.includes(';base64')) atob(payload.replace(/\s/g, ''));
    else decodeURIComponent(payload);
    return true;
  } catch {
    return false;
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
