import type { RouteBulletShape } from '../model/types';
import {
  inlineBulletDiameter,
  parseFormattedLine,
  parseLabelLine,
  type InlineStyleState,
  type SegmentStyle,
} from './labelTokens';

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
  /** Formatting-tag style of a text atom; absent on unstyled runs. */
  style?: SegmentStyle;
  /** Present when kind === 'bullet'. */
  code?: string;
  shape?: RouteBulletShape;
  filled?: boolean;
  diameter?: number;
  x: number;
}

type Tok =
  | { t: 'word'; s: string; style?: SegmentStyle }
  | { t: 'space'; s: string; style?: SegmentStyle }
  | { t: 'bullet'; code: string; shape: RouteBulletShape; filled: boolean };

// Split a rendered line into ordered word / whitespace-run / bullet tokens.
// Whitespace runs stay whole (one token per run = one gap). With an entry
// state the line is parsed under the formatting-tag grammar and each token
// carries its resolved style; without one (station names) tags stay literal.
function tokenize(raw: string, entryStyle?: InlineStyleState): Tok[] {
  const segments = entryStyle ? parseFormattedLine(raw, entryStyle).segments : parseLabelLine(raw);
  const toks: Tok[] = [];
  for (const seg of segments) {
    if (seg.kind === 'bullet') {
      toks.push({ t: 'bullet', code: seg.code, shape: seg.shape, filled: seg.filled });
      continue;
    }
    for (const m of seg.value.match(/\S+|\s+/g) ?? []) {
      const t = /^\s/.test(m) ? ('space' as const) : ('word' as const);
      toks.push(seg.style ? { t, s: m, style: seg.style } : { t, s: m });
    }
  }
  return toks;
}

/**
 * Lay out one rendered line as fully-justified atoms flushing both edges of a
 * `targetWidth` box. `advanceWidth` is the line's natural pen advance; the slack
 * `targetWidth - advanceWidth` is spread evenly across the interior word gaps
 * (whitespace runs with ink on both sides). The first word's pen sits at the
 * left edge and the last word's advance reaches the right edge, matching the
 * pen-origin alignment the non-justified path uses. Leading/trailing whitespace
 * still advances the pen but is never stretched. `measureAdvance` receives each
 * run's style so bold/italic tags measure on the right face; `letterSpacingPx`
 * is the tracking each glyph AND each inline bullet carries, so the internal
 * bullet advance matches the measurer's `advanceWidth` (a bullet advances
 * `diameter + letterSpacingPx`, exactly as `computeLineMetrics` counts it).
 * Returns null when the line can't be justified — no interior gap (single word),
 * or no slack: with advance-based slack, a line whose advance already reaches
 * (or exceeds) the box left-flushes instead, which keeps both edges consistent
 * with the pen-origin alignment (the ink sits one side bearing inside each
 * margin) rather than stretching a line that already fills the box.
 */
export function justifyLine(
  raw: string,
  fontSize: number,
  letterSpacingPx: number,
  advanceWidth: number,
  targetWidth: number,
  measureAdvance: (s: string, style?: SegmentStyle) => number,
  entryStyle?: InlineStyleState,
): JustifyAtom[] | null {
  const toks = tokenize(raw, entryStyle);
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

  const slack = targetWidth - advanceWidth;
  if (slack <= 0) return null;
  const extraPerGap = slack / gaps;

  const atoms: JustifyAtom[] = [];
  let cursor = 0;
  toks.forEach((tk, i) => {
    if (tk.t === 'word') {
      atoms.push(
        tk.style
          ? { kind: 'text', value: tk.s, style: tk.style, x: cursor }
          : { kind: 'text', value: tk.s, x: cursor },
      );
      cursor += measureAdvance(tk.s, tk.style);
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
      // Match the measurer: a bullet advances its diameter PLUS one tracking
      // step (textMeasure counts `d + letterSpacingPx`). Advancing only `d`
      // here would leave the last word short of the right edge by
      // nBullets*letterSpacingPx once slack is measured against advanceWidth.
      cursor += d + letterSpacingPx;
    } else {
      cursor += measureAdvance(tk.s, tk.style);
      // Widen only interior gaps (ink on both sides).
      if (i > firstInk && i < lastInk) cursor += extraPerGap;
    }
  });
  return atoms;
}
