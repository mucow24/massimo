import { FONT_STACK } from '../export/fonts';
import type { RouteBulletShape } from '../model/types';
import {
  emptyStyleState,
  inlineBulletDiameter,
  parseFormattedLine,
  resolveRunWeight,
  type InlineStyleState,
  type LabelSegment,
  type SegmentStyle,
} from './labelTokens';

/**
 * Minimum surface needed to measure a styled multi-line text block. Both
 * TextLabel and station-name renderers satisfy this — the measurer
 * intentionally doesn't depend on the rest of the TextLabel shape so it
 * can serve both without forcing callers to fabricate a fake label.
 */
export interface StyledText {
  text: string;
  fontSize: number;
  weight: number;
  italic: boolean;
  /**
   * When true, `|CODE|` tokens are measured as their literal glyphs rather
   * than collapsing to a bullet circle. The inline rename editor sets this:
   * its textarea shows the raw tokens, so the box must be sized to fit them.
   */
  literalBullets?: boolean;
  /**
   * Line-spacing multiplier between lines (default 1 = the 1.2em LINE_HEIGHT
   * spacing). Affects height only; a single line is one line-height tall at
   * any leading. Only `TextLabel` sets this.
   */
  leading?: number;
  /**
   * Extra letter-spacing in em inside text runs (default 0). Only `TextLabel`
   * sets this.
   */
  tracking?: number;
  /**
   * Column width in world units. 0 or absent = "Auto": lines come straight from
   * splitting on '\n' and the box hugs the widest line's ink (the historical
   * behavior). >0 = a fixed-width column: each '\n'-delimited paragraph is
   * greedily word-wrapped to this width, the box width is pinned to it, and the
   * height follows the wrapped line count. Only `TextLabel` sets this; station
   * names omit it and always measure in Auto mode.
   */
  width?: number;
}

export type SegmentMetric =
  | {
      kind: 'text';
      value: string;
      /** Resolved formatting-tag style; absent on unstyled runs. */
      style?: SegmentStyle;
      /** Distance the cursor moves rightward after rendering. */
      advance: number;
      /** Overhang LEFT of the segment cursor (positive = ink left of cursor). */
      bearingLeft: number;
      /** Overhang RIGHT of the segment cursor (positive = ink right of cursor). */
      bearingRight: number;
    }
  | {
      kind: 'bullet';
      code: string;
      shape: RouteBulletShape;
      filled: boolean;
      /** Advance of the bullet (diameter plus any tracking). */
      advance: number;
      diameter: number;
    };

export interface LineMetrics {
  /** Ink width — distance from leftmost ink to rightmost ink across all segments. */
  inkWidth: number;
  /** Distance from the line-start cursor going LEFT to the leftmost ink pixel. */
  bearingLeft: number;
  /** Distance from the line-start cursor going RIGHT to the rightmost ink pixel. */
  bearingRight: number;
  /**
   * Pen advance of the whole line — the sum of every segment's advance. Text
   * aligns by this (pen origin), NOT by the raw ink extent, so lines flush on
   * the font's designed side bearings and the edges read even. Aligning by ink
   * instead pins each line's leftmost ink *pixel* to the margin, which shoves
   * round/hooked initials (o, c, w, f, v, s…) visibly inward — a ragged,
   * letter-shape-dependent edge.
   */
  advanceWidth: number;
  /** Parsed segments along this line, with their measurements. Empty for an
   *  empty line. */
  segments: SegmentMetric[];
  /** The source string this rendered line was measured from — the raw '\n'
   *  line in Auto mode, or a single wrapped line in column mode. The justify
   *  renderer re-tokenizes it into words. */
  raw: string;
  /** Open formatting-tag state at the START of this line, so the justify
   *  renderer can re-tokenize `raw` with the same state the measurement used.
   *  Only present in formatting mode (absent for station names / edit mode). */
  entryStyle?: InlineStyleState;
  /** True when this is the last rendered line of its justification group: the
   *  last line of the block in Auto mode, or the last line of its paragraph in
   *  column mode. Justify never stretches these (standard typography). */
  endsParagraph: boolean;
}

/** The ink-only fields of a line, before `raw`/`endsParagraph` are attached. */
type LineInk = Pick<
  LineMetrics,
  'inkWidth' | 'bearingLeft' | 'bearingRight' | 'advanceWidth' | 'segments'
>;

/** A measured line plus the tag state it leaves open for the next line. */
type ParsedLine = LineInk & { exit: InlineStyleState | null };

export interface MeasuredBBox {
  /** Box width in pixels: the widest line's ink in Auto mode, or the fixed
   *  column width when a column width is set. 0 when empty in Auto mode. */
  width: number;
  /** Total block height: one line-height plus (lineCount - 1) leading-scaled
   *  line spacings. With the default leading of 1 this is
   *  lineCount * fontSize * LINE_HEIGHT. */
  height: number;
  /** Number of rendered lines — one per '\n' in Auto mode, or the total
   *  wrapped-line count across all paragraphs in column mode. Always >= 1. */
  lineCount: number;
  /** Per-line ink widths (length === lineCount). Mirror of `lines[i].inkWidth`,
   *  kept for back-compat with marquee hit-testing callers. */
  lineWidths: number[];
  /** Per-line ink-aware metrics. */
  lines: LineMetrics[];
}

export const LINE_HEIGHT = 1.2;

/**
 * Fraction of fontSize from the line's top (the `dominantBaseline="hanging"`
 * anchor) down to the visual baseline, for Helvetica-like fonts. Used by
 * inline-bullet renderers to sit the bullet's bottom on the text baseline.
 */
export const BASELINE_FRACTION = 0.8;

// Internal cache: keyed by the full content + style tuple (weight, italic,
// parse mode, font size, column width, leading, tracking, text — see
// cacheKey). Marquee hit testing re-measures every label on every move;
// without a cache the canvas API churn would dominate. Bounded by a soft cap;
// oldest entries evicted.
const CACHE_LIMIT = 256;
const cache = new Map<string, MeasuredBBox>();

function cacheKey(styled: StyledText): string {
  const parseMode = styled.literalBullets ? 'L' : 'f';
  const width = styled.width ?? 0;
  const leading = styled.leading ?? 1;
  const tracking = styled.tracking ?? 0;
  return `${styled.weight}|${styled.italic ? 'i' : 'n'}|${parseMode}|${styled.fontSize}|${width}|${leading}|${tracking}|${styled.text}`;
}

// Lazily-initialised measurement context. Falls back to a heuristic when
// running in environments without a real canvas (jsdom tests).
let ctx: CanvasRenderingContext2D | null | undefined;
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    ctx = canvas ? (canvas.getContext('2d') as CanvasRenderingContext2D | null) : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

// Approximate width when no real canvas is available — overestimates by design
// so marquee hit-testing covers the visible glyphs in tests. Letter-spacing is
// modeled the way Chromium applies it: added after every character.
function approximateLineWidth(line: string, fontSize: number, letterSpacingPx: number): number {
  return line.length * (fontSize * 0.55 + letterSpacingPx);
}

function measureTextSegment(
  value: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  fontDecl: string,
  letterSpacingPx: number,
): { advance: number; bearingLeft: number; bearingRight: number } {
  if (value.length === 0) return { advance: 0, bearingLeft: 0, bearingRight: 0 };
  if (measureCtx) {
    measureCtx.font = fontDecl;
    // Chromium's canvas honors letterSpacing (added after each character,
    // matching SVG letter-spacing); environments without the property just
    // measure untracked.
    if ('letterSpacing' in measureCtx) {
      (measureCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${letterSpacingPx}px`;
    }
    const tm = measureCtx.measureText(value);
    const bL = tm.actualBoundingBoxLeft ?? 0;
    const bR = tm.actualBoundingBoxRight ?? 0;
    const advance = tm.width;
    if (bL > 0 || bR > 0) {
      const adv = advance > 0 ? advance : bL + bR;
      // Leading/trailing whitespace carries advance but no ink, so the canvas
      // ink box (actualBoundingBox*) excludes it. The user typed those spaces
      // and expects them to occupy real width, so extend the segment extent to
      // the pen origin on the left / the full advance on the right whenever the
      // segment begins/ends with whitespace. Interior glyph side bearings stay
      // tight (no ink leakage past the bbox) for the common no-whitespace case.
      const startsWithWs = /^\s/.test(value);
      const endsWithWs = /\s$/.test(value);
      return {
        advance: adv,
        bearingLeft: startsWithWs ? 0 : bL,
        bearingRight: endsWithWs ? adv : bR,
      };
    }
    if (advance > 0) {
      // Real canvas advance but no ink bounds — treat the whole advance as ink.
      return { advance, bearingLeft: 0, bearingRight: advance };
    }
  }
  const approx = approximateLineWidth(value, fontSize, letterSpacingPx);
  return { advance: approx, bearingLeft: 0, bearingRight: approx };
}

/**
 * Pen advance (px) of a single styled text run, measured through the same
 * shared context and font stack as `measureTextLabel`. Whitespace counts toward
 * the advance. The justify renderer uses this to position wrapped words; it
 * resolves any per-segment style (bold/italic tags) into `weight`/`italic`
 * before calling.
 */
export function measureAdvance(
  text: string,
  fontSize: number,
  weight: number,
  italic: boolean,
  letterSpacingPx = 0,
): number {
  if (text.length === 0) return 0;
  const fontDecl = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${FONT_STACK}`;
  return measureTextSegment(text, fontSize, getCtx(), fontDecl, letterSpacingPx).advance;
}

type ParseMode = 'literal' | 'formatted';

function computeLineMetrics(
  raw: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  declFor: (style?: SegmentStyle) => string,
  letterSpacingPx: number,
  mode: ParseMode,
  entry: InlineStyleState | null,
): ParsedLine {
  // Edit mode measures the raw "|CODE|" text as-is; every other caller parses
  // the full inline grammar (bullets + formatting tags), threading the open-tag
  // state from line to line.
  let segments: LabelSegment[];
  let exit: InlineStyleState | null = null;
  if (mode === 'literal') {
    segments = raw.length === 0 ? [] : [{ kind: 'text', value: raw }];
  } else {
    const r = parseFormattedLine(raw, entry ?? emptyStyleState());
    segments = r.segments;
    exit = r.state;
  }
  if (segments.length === 0) {
    return { inkWidth: 0, bearingLeft: 0, bearingRight: 0, advanceWidth: 0, segments: [], exit };
  }
  const segMetrics: SegmentMetric[] = segments.map((seg) => {
    if (seg.kind === 'bullet') {
      const d = inlineBulletDiameter(fontSize);
      return {
        kind: 'bullet',
        code: seg.code,
        shape: seg.shape,
        filled: seg.filled,
        // Tracking spaces bullets like characters: the advance carries the
        // same trailing letter-spacing a glyph would.
        advance: d + letterSpacingPx,
        diameter: d,
      };
    }
    const t = measureTextSegment(
      seg.value,
      fontSize,
      measureCtx,
      declFor(seg.style),
      letterSpacingPx,
    );
    return seg.style
      ? { kind: 'text', value: seg.value, style: seg.style, ...t }
      : { kind: 'text', value: seg.value, ...t };
  });

  // Walk segments to compute the line's ink extent.
  let cursor = 0;
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  for (const sm of segMetrics) {
    const leftAbs = cursor + (sm.kind === 'text' ? -sm.bearingLeft : 0);
    const rightAbs = cursor + (sm.kind === 'text' ? sm.bearingRight : sm.diameter);
    if (leftAbs < inkLeft) inkLeft = leftAbs;
    if (rightAbs > inkRight) inkRight = rightAbs;
    cursor += sm.advance;
  }
  if (!Number.isFinite(inkLeft) || !Number.isFinite(inkRight)) {
    return {
      inkWidth: 0,
      bearingLeft: 0,
      bearingRight: 0,
      advanceWidth: cursor,
      segments: segMetrics,
      exit,
    };
  }
  return {
    inkWidth: inkRight - inkLeft,
    bearingLeft: -inkLeft,
    bearingRight: inkRight,
    advanceWidth: cursor,
    segments: segMetrics,
    exit,
  };
}

/**
 * Greedily word-wrap one paragraph to `width`, returning each wrapped line
 * with the open-tag state it starts under (so committed lines can be
 * re-measured/rendered with the right entry style). Whitespace runs collapse
 * to single-space gaps; a word wider than the column lands on its own
 * (overflowing) line — no mid-word hyphenation. An empty or all-whitespace
 * paragraph yields a single blank line so vertical spacing is preserved.
 */
function wrapParagraph(
  paragraph: string,
  width: number,
  measure: (s: string, entry: InlineStyleState | null) => ParsedLine,
  entry: InlineStyleState | null,
): { raw: string; entry: InlineStyleState | null }[] {
  const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [{ raw: '', entry }];
  const lines: { raw: string; entry: InlineStyleState | null }[] = [];
  let current = '';
  let currentEntry = entry;
  for (const w of words) {
    const candidate = current === '' ? w : `${current} ${w}`;
    // Always keep the first word (even if it alone overflows); otherwise break
    // before a word that would push the line past the column.
    if (current === '' || measure(candidate, currentEntry).inkWidth <= width) {
      current = candidate;
    } else {
      lines.push({ raw: current, entry: currentEntry });
      currentEntry = measure(current, currentEntry).exit;
      current = w;
    }
  }
  lines.push({ raw: current, entry: currentEntry });
  return lines;
}

/**
 * Measure the unrotated bounding box of a styled multi-line text block.
 *
 * Each line is parsed into text + bullet segments (text labels additionally
 * parse formatting tags, whose styles change per-segment font weight/style);
 * widths combine the canvas `measureText` (or a fontSize-based approximation
 * when no real canvas is available) with the inline-bullet diameter and any
 * tracking. Height = one line-height + (lineCount - 1) leading-scaled
 * spacings. Returned values are cached by content+style.
 *
 * Both `TextLabel` and station-name renderers can pass themselves here —
 * `StyledText` is the structural subset of fields the measurer uses.
 */
export function measureTextLabel(styled: StyledText): MeasuredBBox {
  const key = cacheKey(styled);
  const hit = cache.get(key);
  if (hit) return hit;

  const measureCtx = getCtx();
  const mode: ParseMode = styled.literalBullets ? 'literal' : 'formatted';
  const letterSpacingPx = (styled.tracking ?? 0) * styled.fontSize;
  // Measure with the SAME stack the canvas renders (incl. the symbol fallback),
  // so a symbol's measured advance matches its drawn advance — otherwise the
  // inline-bullet cursor spaces it against the wrong (system-fallback) width.
  // Per-segment: a <w=…>/<b>/<i> tag bumps the weight/style for that run only.
  const declFor = (style?: SegmentStyle): string => {
    const w = resolveRunWeight(styled.weight, style);
    const it = styled.italic || style?.italic;
    return `${it ? 'italic ' : ''}${w} ${styled.fontSize}px ${FONT_STACK}`;
  };
  const measure = (raw: string, entry: InlineStyleState | null): ParsedLine =>
    computeLineMetrics(raw, styled.fontSize, measureCtx, declFor, letterSpacingPx, mode, entry);

  const colWidth = styled.width ?? 0;
  const lineMetrics: LineMetrics[] = [];
  const pushLine = (
    raw: string,
    entry: InlineStyleState | null,
    endsParagraph: boolean,
  ): InlineStyleState | null => {
    const { exit, ...ink } = measure(raw, entry);
    lineMetrics.push({ ...ink, raw, endsParagraph, ...(entry ? { entryStyle: entry } : {}) });
    return exit;
  };
  // Formatting tags stay open across '\n' AND column wraps until closed, so
  // the state threads through every rendered line in order.
  let state: InlineStyleState | null = mode === 'formatted' ? emptyStyleState() : null;
  let boxWidth: number;
  if (colWidth > 0) {
    // Column mode: wrap each '\n'-delimited paragraph independently. The box
    // width is pinned to the column; each paragraph's final wrapped line ends a
    // paragraph (justify leaves it ragged), interior wrapped lines don't.
    const paragraphs = styled.text.length === 0 ? [''] : styled.text.split('\n');
    for (const para of paragraphs) {
      const wrapped = wrapParagraph(para, colWidth, measure, state);
      wrapped.forEach((w, i) => {
        state = pushLine(w.raw, w.entry, i === wrapped.length - 1);
      });
    }
    boxWidth = colWidth;
  } else {
    // Auto mode: one rendered line per '\n', box hugs the widest ink. Only the
    // block's final line ends a paragraph (justify leaves it ragged).
    const rawLines = styled.text.length === 0 ? [''] : styled.text.split('\n');
    rawLines.forEach((raw, i) => {
      state = pushLine(raw, state, i === rawLines.length - 1);
    });
    boxWidth = lineMetrics.reduce((m, l) => (l.inkWidth > m ? l.inkWidth : m), 0);
  }
  const lineWidths = lineMetrics.map((m) => m.inkWidth);
  // One full line-height plus a leading-scaled spacing per additional line;
  // leading 1 reproduces the historical lineCount * fontSize * LINE_HEIGHT.
  const height =
    styled.fontSize * LINE_HEIGHT * (1 + (lineMetrics.length - 1) * (styled.leading ?? 1));
  const result: MeasuredBBox = {
    width: boxWidth,
    height,
    lineCount: lineMetrics.length,
    lineWidths,
    lines: lineMetrics,
  };

  if (cache.size >= CACHE_LIMIT) {
    // Drop oldest entry (Map preserves insertion order).
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, result);
  return result;
}

/** Test/dev hook: clear the measurement cache (used by tests). */
export function _clearTextMeasureCache(): void {
  cache.clear();
}
