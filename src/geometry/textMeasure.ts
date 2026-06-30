import { FONT_STACK } from '../export/fonts';
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
      /** Both advance and visible width of the bullet circle. */
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
}

export interface MeasuredBBox {
  /** Width of the widest ink line in pixels. 0 when text is empty. */
  width: number;
  /** Total block height = lineCount * fontSize * LINE_HEIGHT. */
  height: number;
  /** Number of lines after splitting on '\n'. Always >= 1. */
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

// Internal cache: keyed by (text, fontSize, weight, italic). Marquee hit
// testing re-measures every label on every move; without a cache the canvas
// API churn would dominate. Bounded by a soft cap; oldest entries evicted.
const CACHE_LIMIT = 256;
const cache = new Map<string, MeasuredBBox>();

function cacheKey(styled: StyledText): string {
  const bulletMode = styled.literalBullets ? 'L' : 'b';
  return `${styled.weight}|${styled.italic ? 'i' : 'n'}|${bulletMode}|${styled.fontSize}|${styled.text}`;
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

function computeLineMetrics(
  raw: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  fontDecl: string,
  literalBullets: boolean,
): LineMetrics {
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
      return { kind: 'bullet', code: seg.code, advance: d, diameter: d };
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

  const rawLines = styled.text.length === 0 ? [''] : styled.text.split('\n');
  const measureCtx = getCtx();
  // Measure with the SAME stack the canvas renders (incl. the symbol fallback),
  // so a symbol's measured advance matches its drawn advance — otherwise the
  // inline-bullet cursor spaces it against the wrong (system-fallback) width.
  const fontDecl = `${styled.italic ? 'italic ' : ''}${styled.weight} ${styled.fontSize}px ${FONT_STACK}`;

  const lineMetrics: LineMetrics[] = rawLines.map((raw) =>
    computeLineMetrics(raw, styled.fontSize, measureCtx, fontDecl, styled.literalBullets ?? false),
  );
  const lineWidths = lineMetrics.map((m) => m.inkWidth);
  const width = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const height = rawLines.length * styled.fontSize * LINE_HEIGHT;
  const result: MeasuredBBox = {
    width,
    height,
    lineCount: rawLines.length,
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
