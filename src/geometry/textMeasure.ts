import { FONT_STACK } from '../export/fonts';
import type { RouteBulletShape } from '../model/types';
import { inlineBulletDiameter, parseLabelLine, type LabelSegment } from './labelTokens';

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
   * When true, `<CODE>` tokens are measured as their literal glyphs rather
   * than collapsing to a bullet circle. The inline rename editor sets this:
   * its textarea shows the raw tokens, so the box must be sized to fit them.
   */
  literalBullets?: boolean;
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
      /** Both advance and visible width of the bullet shape. */
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
  /** Parsed segments along this line, with their measurements. Empty for an
   *  empty line. */
  segments: SegmentMetric[];
  /** The source string this rendered line was measured from — the raw '\n'
   *  line in Auto mode, or a single wrapped line in column mode. The justify
   *  renderer re-tokenizes it into words. */
  raw: string;
  /** True when this is the last rendered line of its justification group: the
   *  last line of the block in Auto mode, or the last line of its paragraph in
   *  column mode. Justify never stretches these (standard typography). */
  endsParagraph: boolean;
}

/** The ink-only fields of a line, before `raw`/`endsParagraph` are attached. */
type LineInk = Pick<LineMetrics, 'inkWidth' | 'bearingLeft' | 'bearingRight' | 'segments'>;

export interface MeasuredBBox {
  /** Box width in pixels: the widest line's ink in Auto mode, or the fixed
   *  column width when a column width is set. 0 when empty in Auto mode. */
  width: number;
  /** Total block height = lineCount * fontSize * LINE_HEIGHT. */
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
// literal-bullet mode, font size, column width, text — see cacheKey). Marquee
// hit testing re-measures every label on every move; without a cache the
// canvas API churn would dominate. Bounded by a soft cap; oldest entries
// evicted.
const CACHE_LIMIT = 256;
const cache = new Map<string, MeasuredBBox>();

function cacheKey(styled: StyledText): string {
  const bulletMode = styled.literalBullets ? 'L' : 'b';
  const width = styled.width ?? 0;
  return `${styled.weight}|${styled.italic ? 'i' : 'n'}|${bulletMode}|${styled.fontSize}|${width}|${styled.text}`;
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
// so marquee hit-testing covers the visible glyphs in tests.
function approximateLineWidth(line: string, fontSize: number): number {
  return line.length * fontSize * 0.55;
}

function measureTextSegment(
  value: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  fontDecl: string,
): { advance: number; bearingLeft: number; bearingRight: number } {
  if (value.length === 0) return { advance: 0, bearingLeft: 0, bearingRight: 0 };
  if (measureCtx) {
    measureCtx.font = fontDecl;
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
  const approx = approximateLineWidth(value, fontSize);
  return { advance: approx, bearingLeft: 0, bearingRight: approx };
}

/**
 * Pen advance (px) of a single styled text run, measured through the same
 * shared context and font stack as `measureTextLabel`. Whitespace counts toward
 * the advance. The justify renderer uses this to position wrapped words.
 */
export function measureAdvance(
  text: string,
  fontSize: number,
  weight: number,
  italic: boolean,
): number {
  if (text.length === 0) return 0;
  const fontDecl = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${FONT_STACK}`;
  return measureTextSegment(text, fontSize, getCtx(), fontDecl).advance;
}

function computeLineMetrics(
  raw: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  fontDecl: string,
  literalBullets: boolean,
): LineInk {
  // Edit mode measures the raw "<CODE>" text; the normal render path parses
  // tokens into bullet segments.
  const segments: LabelSegment[] = literalBullets
    ? raw.length === 0
      ? []
      : [{ kind: 'text', value: raw }]
    : parseLabelLine(raw);
  if (segments.length === 0) {
    return { inkWidth: 0, bearingLeft: 0, bearingRight: 0, segments: [] };
  }
  const segMetrics: SegmentMetric[] = segments.map((seg) => {
    if (seg.kind === 'bullet') {
      const d = inlineBulletDiameter(fontSize);
      return {
        kind: 'bullet',
        code: seg.code,
        shape: seg.shape,
        filled: seg.filled,
        advance: d,
        diameter: d,
      };
    }
    const t = measureTextSegment(seg.value, fontSize, measureCtx, fontDecl);
    return { kind: 'text', value: seg.value, ...t };
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
    return { inkWidth: 0, bearingLeft: 0, bearingRight: 0, segments: segMetrics };
  }
  return {
    inkWidth: inkRight - inkLeft,
    bearingLeft: -inkLeft,
    bearingRight: inkRight,
    segments: segMetrics,
  };
}

/**
 * Greedily word-wrap one paragraph to `width`, returning the wrapped lines.
 * Whitespace runs collapse to single-space gaps; a word wider than the column
 * lands on its own (overflowing) line — no mid-word hyphenation. An empty or
 * all-whitespace paragraph yields a single blank line so vertical spacing is
 * preserved.
 */
function wrapParagraph(
  paragraph: string,
  width: number,
  measure: (s: string) => LineInk,
): string[] {
  const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current === '' ? w : `${current} ${w}`;
    // Always keep the first word (even if it alone overflows); otherwise break
    // before a word that would push the line past the column.
    if (current === '' || measure(candidate).inkWidth <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Measure the unrotated bounding box of a styled multi-line text block.
 *
 * Each line is parsed into text + bullet segments; widths combine the canvas
 * `measureText` (or a fontSize-based approximation when no real canvas is
 * available) with the inline-bullet diameter. Height = lineCount * fontSize
 * * LINE_HEIGHT. Returned values are cached by content+style.
 *
 * Both `TextLabel` and station-name renderers can pass themselves here —
 * `StyledText` is the structural subset of fields the measurer uses.
 */
export function measureTextLabel(styled: StyledText): MeasuredBBox {
  const key = cacheKey(styled);
  const hit = cache.get(key);
  if (hit) return hit;

  const measureCtx = getCtx();
  // Measure with the SAME stack the canvas renders (incl. the symbol fallback),
  // so a symbol's measured advance matches its drawn advance — otherwise the
  // inline-bullet cursor spaces it against the wrong (system-fallback) width.
  const fontDecl = `${styled.italic ? 'italic ' : ''}${styled.weight} ${styled.fontSize}px ${FONT_STACK}`;
  const measure = (raw: string): LineInk =>
    computeLineMetrics(raw, styled.fontSize, measureCtx, fontDecl, styled.literalBullets ?? false);

  const colWidth = styled.width ?? 0;
  let lineMetrics: LineMetrics[];
  let boxWidth: number;
  if (colWidth > 0) {
    // Column mode: wrap each '\n'-delimited paragraph independently. The box
    // width is pinned to the column; each paragraph's final wrapped line ends a
    // paragraph (justify leaves it ragged), interior wrapped lines don't.
    const paragraphs = styled.text.length === 0 ? [''] : styled.text.split('\n');
    lineMetrics = [];
    for (const para of paragraphs) {
      const wrapped = wrapParagraph(para, colWidth, measure);
      wrapped.forEach((raw, i) => {
        lineMetrics.push({ ...measure(raw), raw, endsParagraph: i === wrapped.length - 1 });
      });
    }
    boxWidth = colWidth;
  } else {
    // Auto mode: one rendered line per '\n', box hugs the widest ink. Only the
    // block's final line ends a paragraph (justify leaves it ragged).
    const rawLines = styled.text.length === 0 ? [''] : styled.text.split('\n');
    lineMetrics = rawLines.map((raw, i) => ({
      ...measure(raw),
      raw,
      endsParagraph: i === rawLines.length - 1,
    }));
    boxWidth = lineMetrics.reduce((m, l) => (l.inkWidth > m ? l.inkWidth : m), 0);
  }
  const lineWidths = lineMetrics.map((m) => m.inkWidth);
  const height = lineMetrics.length * styled.fontSize * LINE_HEIGHT;
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
