// Pure helpers for importing an .svg file: read its intrinsic size for the
// initial on-canvas dimensions, and encode it as an opaque data URI.

const FALLBACK_SIZE = { width: 200, height: 200 } as const;

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

/**
 * Encode SVG source text as a `data:image/svg+xml;base64,…` URI. Encodes to
 * UTF-8 bytes before base64 so non-Latin1 content (e.g. CJK labels) doesn't
 * throw — the naive `btoa(text)` form does.
 */
export function svgTextToDataUri(text: string): string {
  const bytes = new globalThis.TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${globalThis.btoa(binary)}`;
}
