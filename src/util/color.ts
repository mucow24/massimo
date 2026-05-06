// Pick black or white text for legibility against an arbitrary hex bg.
// Uses the W3C relative-luminance formula.
export function legibleTextOn(hex: string): string {
  const m = hex.replace('#', '');
  const v =
    m.length === 3
      ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]]
      : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)];
  const [r, g, b] = v.map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? '#000' : '#fff';
}

function parseHex(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v =
    m.length === 3
      ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]]
      : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)];
  return [parseInt(v[0], 16), parseInt(v[1], 16), parseInt(v[2], 16)];
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Mix between original and luma greyscale. amount=1 keeps original color,
// amount=0 returns the per-pixel luma (full greyscale).
export function desaturateColor(hex: string, amount: number): string {
  if (amount >= 1) return hex;
  const [r, g, b] = parseHex(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.max(0, Math.min(1, amount));
  return toHex(y + (r - y) * t, y + (g - y) * t, y + (b - y) * t);
}
