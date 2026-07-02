import type { RouteBulletShape } from '../model/types';
import { inlineBulletDiameter, parseLabelLine } from './labelTokens';

/**
 * One positioned piece of a fully-justified line. `x` is the pen position
 * relative to the line-start cursor (0 = where a left-aligned line would begin,
 * i.e. left ink flush to the box's left edge). The renderer offsets every atom
 * by that same line-start so justified lines share the left edge of the ragged
 * last line.
 */
export interface JustifyAtom {
  kind: 'text' | 'bullet';
  /** Present when kind === 'text'. */
  value?: string;
  /** Present when kind === 'bullet'. */
  code?: string;
  shape?: RouteBulletShape;
  filled?: boolean;
  diameter?: number;
  x: number;
}

type Tok =
  | { t: 'word'; s: string }
  | { t: 'space'; s: string }
  | { t: 'bullet'; code: string; shape: RouteBulletShape; filled: boolean };

// Split a rendered line into ordered word / whitespace-run / bullet tokens.
// Whitespace runs stay whole (one token per run = one gap).
function tokenize(raw: string): Tok[] {
  const toks: Tok[] = [];
  for (const seg of parseLabelLine(raw)) {
    if (seg.kind === 'bullet') {
      toks.push({ t: 'bullet', code: seg.code, shape: seg.shape, filled: seg.filled });
      continue;
    }
    for (const m of seg.value.match(/\S+|\s+/g) ?? []) {
      toks.push(/^\s/.test(m) ? { t: 'space', s: m } : { t: 'word', s: m });
    }
  }
  return toks;
}

/**
 * Lay out one rendered line as fully-justified atoms flushing both edges of a
 * `targetWidth` box. `inkWidth` is the line's measured ink extent; the slack
 * `targetWidth - inkWidth` is spread evenly across the interior word gaps
 * (whitespace runs with ink on both sides). Leading/trailing whitespace still
 * advances the pen but is never stretched. Returns null when the line can't be
 * justified — no interior gap (single word), or no slack (ink already fills or
 * overflows the box) — so the caller renders it left-flush instead.
 */
export function justifyLine(
  raw: string,
  fontSize: number,
  inkWidth: number,
  targetWidth: number,
  measureAdvance: (s: string) => number,
): JustifyAtom[] | null {
  const toks = tokenize(raw);
  let firstInk = -1;
  let lastInk = -1;
  toks.forEach((tk, i) => {
    if (tk.t !== 'space') {
      if (firstInk < 0) firstInk = i;
      lastInk = i;
    }
  });
  if (firstInk < 0) return null; // no ink at all

  let gaps = 0;
  for (let i = firstInk + 1; i < lastInk; i++) if (toks[i].t === 'space') gaps++;
  if (gaps === 0) return null;

  const slack = targetWidth - inkWidth;
  if (slack <= 0) return null;
  const extraPerGap = slack / gaps;

  const atoms: JustifyAtom[] = [];
  let cursor = 0;
  toks.forEach((tk, i) => {
    if (tk.t === 'word') {
      atoms.push({ kind: 'text', value: tk.s, x: cursor });
      cursor += measureAdvance(tk.s);
    } else if (tk.t === 'bullet') {
      const d = inlineBulletDiameter(fontSize);
      atoms.push({
        kind: 'bullet',
        code: tk.code,
        shape: tk.shape,
        filled: tk.filled,
        diameter: d,
        x: cursor,
      });
      cursor += d;
    } else {
      cursor += measureAdvance(tk.s);
      // Widen only interior gaps (ink on both sides).
      if (i > firstInk && i < lastInk) cursor += extraPerGap;
    }
  });
  return atoms;
}
