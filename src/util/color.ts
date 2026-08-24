import { clamp } from './grid';

// Pick black or white text for legibility against an arbitrary hex bg.
// Uses the W3C relative-luminance formula.
export function legibleTextOn(hex: string): string {
  const [r, g, b] = parseHex(hex).map((n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? '#000' : '#fff';
}

function parseHex(hex: string): [number, number, number] {
  const m = hex.replace('#', '').trim();
  // 3- or 4-digit shorthand (#rgb / #rgba): each nibble is doubled. Any alpha
  // nibble (the 4th) is ignored — these helpers are RGB-only.
  if (/^[0-9a-fA-F]{3}$/.test(m) || /^[0-9a-fA-F]{4}$/.test(m)) {
    return [parseInt(m[0] + m[0], 16), parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16)];
  }
  // 6- or 8-digit (#rrggbb / #rrggbbaa): take the first three channels; any
  // trailing alpha pair is ignored.
  if (/^[0-9a-fA-F]{6}$/.test(m) || /^[0-9a-fA-F]{8}$/.test(m)) {
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  // Anything else (rgb()/hsl()/named colors, or malformed input from a
  // hand-edited map file) — fall back to black rather than propagate NaN
  // through the luminance / rgba() math downstream.
  return [0, 0, 0];
}

// Parse a hex color to [r, g, b, a], each 0-255. Alpha defaults to 255 (opaque)
// for the alpha-less #rgb / #rrggbb forms. Companion to parseHex for the paths
// that must PRESERVE transparency (desaturating a translucent line color)
// rather than flatten it. Malformed input falls back to opaque black, matching
// parseHex.
export function parseHexA(hex: string): [number, number, number, number] {
  const [r, g, b] = parseHex(hex);
  const m = hex.replace('#', '').trim();
  if (/^[0-9a-fA-F]{4}$/.test(m)) return [r, g, b, parseInt(m[3] + m[3], 16)];
  if (/^[0-9a-fA-F]{8}$/.test(m)) return [r, g, b, parseInt(m.slice(6, 8), 16)];
  return [r, g, b, 255];
}

// Emit a hex string. With alpha 255 (the default) this is the historical
// 6-digit `#rrggbb`; a sub-255 alpha appends the two-nibble suffix (`#rrggbbaa`)
// so translucent colors round-trip. Keeping opaque colors 6-digit means stored
// colors, palette-swatch matching, and existing saves don't churn.
function toHex(r: number, g: number, b: number, a = 255): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const rgb = `#${h(r)}${h(g)}${h(b)}`;
  return a >= 255 ? rgb : `${rgb}${h(a)}`;
}

// Canonical stored form of any hex color: lowercase, shorthand expanded, and
// an opaque (`ff`) alpha suffix stripped back to 6 digits. Translucent colors
// keep their `#rrggbbaa` form. Malformed input collapses to `#000000`. Used to
// normalize picker output and to compare a value against palette swatches
// without a spurious `ff` making an opaque color miss its 6-digit swatch.
export function normalizeHex(hex: string): string {
  const [r, g, b, a] = parseHexA(hex);
  return toHex(r, g, b, a);
}

// Return `hex` with its alpha channel set to the byte `a` (0-255), normalized so
// an opaque result (a ≥ 255) drops back to 6 digits. The RGB is taken from
// `hex`; any alpha it already carries is replaced. Used to fold the legacy
// polygon fill-opacity percentage into the fill color's alpha.
export function withHexAlpha(hex: string, a: number): string {
  const [r, g, b] = parseHexA(hex);
  return toHex(r, g, b, clamp(Math.round(a), 0, 255));
}

// Returns a CSS rgba() string with the given alpha applied to a hex color.
// Use for tints/chips where you want the line color blended with whatever
// is behind it.
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Mix between original and luma greyscale. amount=1 keeps original color,
// amount=0 returns the per-pixel luma (full greyscale).
export function desaturateColor(hex: string, amount: number): string {
  if (amount >= 1) return hex;
  const [r, g, b, a] = parseHexA(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = clamp(amount, 0, 1);
  // Desaturate only the RGB; the source alpha rides through so a dimmed
  // non-selected line keeps its transparency.
  return toHex(y + (r - y) * t, y + (g - y) * t, y + (b - y) * t, a);
}
