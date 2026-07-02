import type { RouteBulletShape } from '../model/types';

export type LabelSegment =
  | { kind: 'text'; value: string }
  | { kind: 'bullet'; code: string; shape: RouteBulletShape; filled: boolean };

/**
 * Inline bullet circle diameter, as a fraction of the host fontSize. Picked
 * to be a little shorter than the line's font height so a bullet sits
 * comfortably between baselines rather than dominating the row.
 */
export const INLINE_BULLET_DIAMETER_RATIO = 0.9;

export function inlineBulletDiameter(fontSize: number): number {
  return fontSize * INLINE_BULLET_DIAMETER_RATIO;
}

/**
 * Parse a single label line into segments of either literal text or a bullet
 * token. The delimiter picks the shape — `<CODE>` circle, `[CODE]` square,
 * `{CODE}` diamond — and doubling it (`<<CODE>>`, `[[CODE]]`, `{{CODE}}`)
 * makes the bullet unfilled (line-color outline instead of a filled shape).
 * A code can't contain any delimiter character or a newline; unclosed or
 * mismatched delimiters and empty codes stay as literal text.
 */
const CODE = '[^<>[\\]{}\\n]+';
// Doubled (unfilled) alternatives listed before their single (filled) forms so
// they win at the same start position.
const BULLET_TOKEN_RE = new RegExp(
  `<<(${CODE})>>|<(${CODE})>|\\[\\[(${CODE})\\]\\]|\\[(${CODE})\\]|\\{\\{(${CODE})\\}\\}|\\{(${CODE})\\}`,
  'g',
);
// Capture-group index (1-based) → the bullet variant that group encodes.
const GROUP_VARIANTS: { shape: RouteBulletShape; filled: boolean }[] = [
  { shape: 'circle', filled: false },
  { shape: 'circle', filled: true },
  { shape: 'square', filled: false },
  { shape: 'square', filled: true },
  { shape: 'diamond', filled: false },
  { shape: 'diamond', filled: true },
];

export function parseLabelLine(line: string): LabelSegment[] {
  if (line.length === 0) return [];
  const segments: LabelSegment[] = [];
  let lastIndex = 0;
  // Reset; regex has the /g flag so its lastIndex is mutable.
  BULLET_TOKEN_RE.lastIndex = 0;
  for (let m = BULLET_TOKEN_RE.exec(line); m !== null; m = BULLET_TOKEN_RE.exec(line)) {
    if (m.index > lastIndex) {
      segments.push({ kind: 'text', value: line.slice(lastIndex, m.index) });
    }
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    const { shape, filled } = GROUP_VARIANTS[group - 1];
    segments.push({ kind: 'bullet', code: m[group], shape, filled });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < line.length) {
    segments.push({ kind: 'text', value: line.slice(lastIndex) });
  }
  return segments;
}

/**
 * Quick test: does this (possibly multi-line) text contain any bullet token?
 * Renderers use it to pick the plain fast path over segment-aware layout.
 */
export function hasBulletToken(text: string): boolean {
  BULLET_TOKEN_RE.lastIndex = 0;
  return BULLET_TOKEN_RE.test(text);
}
