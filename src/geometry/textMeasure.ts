import type { TextLabel } from '../model/types';

export interface MeasuredBBox {
  /** Width of the widest text line in pixels. 0 when text is empty. */
  width: number;
  /** Total block height = lineCount * fontSize * LINE_HEIGHT. */
  height: number;
  /** Number of lines after splitting on '\n'. Always >= 1. */
  lineCount: number;
  /** Per-line widths (length === lineCount). */
  lineWidths: number[];
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

/**
 * Measure the unrotated bounding box of a TextLabel's rendered text.
 *
 * Width is the max line width via canvas `measureText` (or a fontSize-based
 * approximation when no real canvas is available). Height = lineCount *
 * fontSize * LINE_HEIGHT. Returned values are cached by content+style.
 */
export function measureTextLabel(label: TextLabel): MeasuredBBox {
  const key = cacheKey(label);
  const hit = cache.get(key);
  if (hit) return hit;

  const lines = label.text.length === 0 ? [''] : label.text.split('\n');
  const measureCtx = getCtx();
  const fontDecl = `${label.italic ? 'italic ' : ''}${label.weight} ${label.fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  if (measureCtx) measureCtx.font = fontDecl;

  const lineWidths: number[] = lines.map((line) => {
    if (line.length === 0) return 0;
    if (measureCtx) {
      const m = measureCtx.measureText(line);
      // Some environments (jsdom) return 0; fall back so tests still see a bbox.
      return m.width > 0 ? m.width : approximateLineWidth(line, label.fontSize);
    }
    return approximateLineWidth(line, label.fontSize);
  });
  const width = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const height = lines.length * label.fontSize * LINE_HEIGHT;
  const result: MeasuredBBox = {
    width,
    height,
    lineCount: lines.length,
    lineWidths,
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
