export type LabelSegment = { kind: 'text'; value: string } | { kind: 'bullet'; code: string };

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
 * Parse a single label line into segments of either literal text or a
 * bullet token of the form `<CODE>`. Unclosed `<`, stray `>`, and empty
 * `<>` stay as literal text.
 */
const BULLET_TOKEN_RE = /<([^<>]+)>/g;

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
    segments.push({ kind: 'bullet', code: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < line.length) {
    segments.push({ kind: 'text', value: line.slice(lastIndex) });
  }
  return segments;
}
