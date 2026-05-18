import type { TextLabel } from '../model/types';
import { inlineBulletDiameter, parseLabelLine } from './labelTokens';

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

// Internal cache: keyed by (text, fontSize, weight, italic). Marquee hit
// testing re-measures every label on every move; without a cache the canvas
// API churn would dominate. Bounded by a soft cap; oldest entries evicted.
const CACHE_LIMIT = 256;
const cache = new Map<string, MeasuredBBox>();

function cacheKey(label: TextLabel): string {
  return `${label.weight}|${label.italic ? 'i' : 'n'}|${label.fontSize}|${label.text}`;
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
      return { advance: advance > 0 ? advance : bL + bR, bearingLeft: bL, bearingRight: bR };
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
): LineMetrics {
  const segments = parseLabelLine(raw);
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
 * Measure the unrotated bounding box of a TextLabel's rendered text.
 *
 * Each line is parsed into text + bullet segments; widths combine the canvas
 * `measureText` (or a fontSize-based approximation when no real canvas is
 * available) with the inline-bullet diameter. Height = lineCount * fontSize
 * * LINE_HEIGHT. Returned values are cached by content+style.
 */
export function measureTextLabel(label: TextLabel): MeasuredBBox {
  const key = cacheKey(label);
  const hit = cache.get(key);
  if (hit) return hit;

  const rawLines = label.text.length === 0 ? [''] : label.text.split('\n');
  const measureCtx = getCtx();
  const fontDecl = `${label.italic ? 'italic ' : ''}${label.weight} ${label.fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  const lineMetrics: LineMetrics[] = rawLines.map((raw) =>
    computeLineMetrics(raw, label.fontSize, measureCtx, fontDecl),
  );
  const lineWidths = lineMetrics.map((m) => m.inkWidth);
  const width = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const height = rawLines.length * label.fontSize * LINE_HEIGHT;
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
