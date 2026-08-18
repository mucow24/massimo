import { FONT_STACK } from '../util/fonts';
import type { RouteBulletShape, TextLabelAlign } from '../model/types';
import {
  emptyStyleState,
  inlineBulletDiameter,
  parseFormattedLine,
  resolveRunFontSize,
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
      /** Resolved font size (world units) this run renders and was measured at —
       *  the label's base size unless an inline `<size=…>` overrides it. The
       *  renderers draw the run at exactly this size. */
      fontSize: number;
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
  /**
   * `advanceWidth` minus the ONE trailing letter-spacing step the last glyph
   * (or bullet) carries — the reference every ALIGNMENT decision uses.
   *
   * Tracking is emitted after each character, so the pen ends one step past the
   * last ink while the measured bbox is sized by ink. Aligning by the raw
   * advance therefore pushes a right- or centre-aligned tracked line that whole
   * step out of its own selection ring, hit rect and exported AABB. Positioning
   * still happens in pen space (see `advanceWidth`) — this only drops the
   * phantom gap that has no ink behind it. Equal to `advanceWidth` when there is
   * no tracking, which is why the bug hid.
   */
  alignAdvance: number;
  /**
   * Largest resolved run size (world units) on this line — the label's base size
   * when nothing is tagged bigger; inline bullets count as the base size. The
   * line occupies one LINE_HEIGHT of this, so a bigger inline `<size>` grows the
   * line and a smaller one shrinks it ("line height follows its content").
   */
  maxFontSize: number;
  /**
   * Distance from the block's top edge down to this line's shared text baseline.
   * Runs of different sizes on a line all sit on this baseline; the renderers
   * place line i here. Cumulative across lines (each line advances by its own
   * `maxFontSize * LINE_HEIGHT * leading`), so it reduces to
   * `BASELINE_FRACTION*fontSize + i*fontSize*LINE_HEIGHT*leading` when every line
   * is the base size.
   */
  baselineFromTop: number;
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

/** The ink-only fields of a line, before `raw`/`endsParagraph`/`baselineFromTop`
 *  are attached (`baselineFromTop` needs the whole block, so it's filled in a
 *  second pass by `measureTextLabel`). */
type LineInk = Pick<
  LineMetrics,
  | 'inkWidth'
  | 'bearingLeft'
  | 'bearingRight'
  | 'advanceWidth'
  | 'alignAdvance'
  | 'maxFontSize'
  | 'segments'
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
 * Fraction of fontSize from the 1.0em EM box top down to the visual baseline,
 * for Helvetica-like fonts. Both the layout and the renderers reach it from the
 * line's CENTER — `fontSize * (BASELINE_FRACTION - 0.5)` — because labelLayout
 * works in a 1.2em LINE box and the two boxes share a center but not their
 * edges (see stationLabelText's firstLineBaselineY).
 *
 * It is deliberately NOT a `dominant-baseline` mode's offset. Chrome derives
 * those from platform font metrics, so nothing here can predict them; see
 * capCenterDy below for the full account.
 *
 * Because the model and the paint apply the same number, it cancels out of every
 * autoAlign pin: changing it slides the glyphs inside their own hit rect and
 * wash, but never moves a baseline or cap line off the marker it was pinned to.
 * CAP_FRACTION is the constant those pins actually ride on.
 */
export const BASELINE_FRACTION = 0.8;

/**
 * Cap height as a fraction of fontSize (Söhne: `sCapHeight` 718/1000 em, which
 * its own `H` matches exactly) — the height of the **Core Type Area**, baseline
 * up to cap line, which is what the transitmap.net tutorials align labels by and
 * what autoAlign implements (baseline sits above a line, cap line hangs below
 * it, CTA center goes beside it, the facing CTA corner pins on a 45°).
 * Hardcoded — nothing reads font tables at runtime.
 */
export const CAP_FRACTION = 0.718;

/**
 * How far the deepest ink drops below the baseline, as a fraction of fontSize —
 * the other side of the em box from BASELINE_FRACTION, and a shade deeper than
 * the shipped Söhne actually descends (its `p` bottoms out at 180/1000), so the
 * clearance it buys is never short.
 *
 * The Core Type Area ends AT the baseline, so nothing else in the label model
 * accounts for a descender. `autoAlign` charges HALF of this — scaled by the
 * vertical share of the approach — to every label sitting above a route line,
 * unconditionally rather than per-name: pushing up only the names that own a
 * descender is exactly the ragged-baseline effect the transitmap.net tutorial
 * rules out. Nothing measures real ink depth — like CAP_FRACTION this is the
 * font model, not a measurement.
 */
export const DESCENDER_FRACTION = 1 - BASELINE_FRACTION;

/**
 * Baseline offset that optically centers a run of CAPS/digits on a shape's
 * center: `y = centerY + capCenterDy(fontSize)`, leaving the text on the
 * default (alphabetic) baseline. For badge-style text — a service code in a
 * stop dot or route bullet, "WP" in a lozenge, a one-letter handle.
 *
 * Do NOT center that text with `dominantBaseline="central"` instead. It is wrong
 * twice over. It centers the font's ascent..descent box rather than the cap box,
 * which is a different point even for a well-behaved face — Söhne's 1171/-423
 * puts `central` 0.374em up where the cap box wants 0.359em. And Chrome sources
 * those metrics from a different table per platform (usWinAscent/Descent on
 * Windows, hhea via CoreText on macOS), so for any face whose two sets disagree
 * the error also varies by platform: Helvetica Neue's 904/-214 against 714/-198
 * put identical markup ~0.09em lower on a Mac. Söhne's two sets happen to agree,
 * but the alphabetic baseline is platform-invariant for every face — and is what
 * `export/pdfText` normalizes to.
 *
 * Only valid for text with no descenders and no non-Latin glyphs — it centers
 * the CAP BOX, not the ink. A dingbat from the DejaVu fallback (say the ⚠ on a
 * routing warning) isn't described by CAP_FRACTION at all.
 */
export const capCenterDy = (fontSize: number) => (fontSize * CAP_FRACTION) / 2;

// Internal cache: keyed by the full content + style tuple (weight, italic,
// parse mode, font size, column width, leading, tracking, text — see
// cacheKey). Marquee hit testing re-measures every label on every move;
// without a cache the canvas API churn would dominate. Bounded by a soft cap;
// oldest entries evicted.
//
// The cap MUST stay well clear of the number of labels a drawing renders, and
// the reason is that undershooting it is a cliff rather than a slope: a render
// measures every label once, in the same order every time, so the access
// pattern is a cyclic scan — and a cyclic scan over a working set larger than
// the cache hits NOTHING, whatever gets evicted. One label past the cap takes
// the hit rate from 100% to 0%.
//
// That is not an abstract risk: the cap sat at 256 while a ~490-station drawing
// rendered ~500 keys, so every hover, press and click re-measured the whole map
// — 531ms per hover, 2045ms per station press, 3155ms per alt+click, against ~0
// once the working set fits. It went unnoticed because a miss used to be two
// cheap measureText calls; the ink probe below made a miss two canvas rasters
// and two full getImageData readbacks, roughly fifty times dearer, and the cap
// was never revisited. `textMeasure.cache.test.ts` holds both sides of the
// number.
//
// A late webfont is the other way into that storm, and `invalidateMeasuredFaces`
// below is what keeps it out.
export const TEXT_MEASURE_CACHE_LIMIT = 5000;

/** A measured label, plus the faces its measurement REQUESTED — the run
 *  weight/style each declaration named, not whatever CSS font matching went on
 *  to serve. That is what lets a late webfont drop only what it staled. Inline
 *  `<b>` / `<w=…>` runs put their own weight in the set, so the label's own
 *  weight is not enough to answer this. */
interface CacheEntry {
  bbox: MeasuredBBox;
  faces: ReadonlySet<string>;
}
const cache = new Map<string, CacheEntry>();

/** A shipped face's identity, as both the measurer and `@font-face` name it. */
const faceKey = (weight: number, italic: boolean): string => `${weight}|${italic ? 'i' : 'n'}`;

/** A CSS family token as the CSSOM may hand it back — possibly quoted. */
const unquote = (family: string): string => family.trim().replace(/^['"]|['"]$/g, '');

// The text face is the FIRST family in the stack — taken from FONT_STACK so the
// name is not written down twice. It has to be the first ENTRY rather than
// membership of the stack: `FONT_STACK.includes(face.family)` would also match
// the symbol and DejaVu fallbacks, and those are precisely the faces that
// CANNOT be narrowed by weight, since either can supply glyphs to a run at any
// weight.
const TEXT_FAMILY = unquote(FONT_STACK.split(',')[0]);

/** The `FontFace` fields {@link invalidateMeasuredFaces} reads. */
export interface ArrivedFace {
  family: string;
  weight: string;
  style: string;
}

/**
 * Drop what a newly-arrived webfont just made stale, and only that.
 *
 * `document.fonts` fires `loadingdone` whenever a face finishes loading, which
 * mid-session means some label was the first to ask for that weight. Clearing
 * the whole cache there re-measures every label on the map through the raster
 * probe — 587ms on a 464-station drawing, the same storm the cap above exists
 * to prevent, just triggered by bolding one label instead.
 *
 * Narrowing is sound only for the text family. A face from the fallback chain
 * (the symbol font, DejaVu) can supply glyphs to ANY declaration, so nothing
 * can be ruled out and the whole cache goes — as it does for a weight this
 * cannot read, which includes a variable font's range.
 *
 * It is also sound only while `styles.css` declares a face for EVERY rung of
 * `LABEL_WEIGHT_NAMES` in both normal and italic, which
 * `textMeasure.cache.test.ts` pins. An entry names the face its measurement
 * ASKED for; CSS matching is free to serve a request from a neighbouring face
 * when the exact one is missing. Drop a rung and those labels record a face
 * that never arrives, so nothing ever invalidates them and they keep their
 * fallback metrics for the rest of the session — sub-pixel, silent, and not
 * recoverable short of an unrelated edit to the same label.
 */
export function invalidateMeasuredFaces(faces: readonly ArrivedFace[]): void {
  // Nothing named means nothing can be ruled out.
  if (faces.length === 0) {
    cache.clear();
    return;
  }
  const stale = new Set<string>();
  for (const f of faces) {
    const weight = /^\d+$/.test(f.weight.trim()) ? Number(f.weight.trim()) : NaN;
    // Exact family, not a substring: a future 'Soehne Mono' is a DIFFERENT
    // face, and narrowing by its weight would leave real text entries stale.
    if (unquote(f.family) !== TEXT_FAMILY || !Number.isFinite(weight)) {
      cache.clear();
      return;
    }
    stale.add(faceKey(weight, f.style.trim() === 'italic'));
  }
  for (const [key, entry] of cache) {
    // An entry that recorded no face was measured without resolving one — the
    // no-canvas fallback takes the length estimate and never builds a
    // declaration. Unknown provenance invalidates, so a future path that
    // measures some other way cannot strand stale metrics here forever.
    if (entry.faces.size === 0) {
      cache.delete(key);
      continue;
    }
    for (const face of entry.faces) {
      if (stale.has(face)) {
        cache.delete(key);
        break;
      }
    }
  }
}

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

// Ink bounds are re-measured at this multiple of the run size and scaled back
// down: Chrome quantizes `actualBoundingBox*` to whole px at the MEASURED
// size, and the measurer measures at fontSize-as-px, so a single-size measure
// carries up to ~a whole world unit of bearing slop at any font size — a
// visible ring-vs-ink sliver once the alignment box hugs the ink. Advances
// deliberately keep the base-size measure: layout is advance-positioned, and
// its numbers must not move with bearing resolution.
//
// Even at a large multiple the measured bounds are only CONSERVATIVE: they
// converge to the font's outline bounding box, curve control points included,
// which for Söhne's heavy cuts sits up to ~0.01em outside the painted ink.
// So the hi-res measure is the seed and the fallback; where rasterization is
// available the true edges come from `probeInkEdges` below.
const BEARING_MEASURE_SCALE = 64;

// ---------- Raster probe: exact ink edges ----------
//
// The one instrument that reports where paint actually lands: draw the
// segment into an offscreen canvas — the same Skia rasterizer that paints the
// SVG — and scan a narrow strip for the first ink column. The strip sits just
// inside the conservative measured bound (true ink can only be INSIDE it), so
// the readback stays tiny (~0.02–0.08ms per side) and only runs on
// measurement-cache misses. jsdom (and the test suites' canvas stubs) have no
// rasterizer, so the probe reports unsupported and bearings keep the hi-res
// measure — the unit-testable arm.

// The probe draws at fontSize × PROBE_TARGET_SCALE device px (precision =
// 1/scale world units), clamped so huge display labels don't raster
// megapixel strips — above the cap, precision degrades gracefully in world
// units while staying constant per em.
const PROBE_TARGET_SCALE = 16;
const PROBE_MIN_PX = 256;
const PROBE_MAX_PX = 1024;
// A column counts as ink above this alpha — the same visible-edge convention
// the calibration raster used; below it is antialiasing fringe.
const PROBE_ALPHA = 32;
// Strip width in em: the gap between the conservative bound and true ink was
// measured at ≤ ~0.03em (outline-bbox slack + hi-res quantization); 0.12em is
// generous. A miss widens once to catch pathological glyphs, then gives up
// and keeps the conservative bound.
const PROBE_STRIP_EM = 0.12;
const PROBE_WIDE_STRIP_EM = 0.5;

let probeCtx: CanvasRenderingContext2D | null | undefined;
function getProbeCtx(): CanvasRenderingContext2D | null {
  if (probeCtx !== undefined) return probeCtx;
  try {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const ctx = canvas
      ? (canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null)
      : null;
    // A real rasterizer or nothing: the measure stubs (and jsdom) lack
    // fillText/getImageData, which is exactly the signal to fall back.
    probeCtx =
      ctx && typeof ctx.fillText === 'function' && typeof ctx.getImageData === 'function'
        ? ctx
        : null;
  } catch {
    probeCtx = null;
  }
  return probeCtx;
}

// Scan one edge: raster `value` so the CONSERVATIVE edge sits a few px inside
// the strip, and walk columns inward until the first ink. Returns the refined
// edge in world units (pen-origin-relative), or null when the strip holds no
// ink at all (caller widens, then gives up).
function probeEdge(
  ctx: CanvasRenderingContext2D,
  value: string,
  declAt: (px: number) => string,
  fontSize: number,
  letterSpacingPx: number,
  side: 'left' | 'right',
  conservative: number,
  stripEm: number,
): number | null {
  const probePx = Math.min(PROBE_MAX_PX, Math.max(PROBE_MIN_PX, fontSize * PROBE_TARGET_SCALE));
  const s = probePx / fontSize;
  const canvas = ctx.canvas;
  const w = Math.ceil(stripEm * fontSize * s) + 8;
  const h = Math.ceil(1.7 * fontSize * s);
  // Resizing clears the canvas; the assignments also bound the readback.
  canvas.width = w;
  canvas.height = h;
  ctx.font = declAt(probePx);
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${letterSpacingPx * s}px`;
  }
  // True ink is INSIDE the conservative bound, so anchor the strip on it:
  // for the left edge the strip runs rightward from 4px inside the left
  // border; for the right edge it runs leftward from 4px inside the right.
  const edgePx = side === 'left' ? 4 : w - 4;
  const penX = edgePx - conservative * s;
  ctx.fillText(value, penX, 1.2 * fontSize * s);
  const img = ctx.getImageData(0, 0, w, h).data;
  const inked = (x: number): boolean => {
    for (let y = 0; y < h; y++) if (img[(y * w + x) * 4 + 3] > PROBE_ALPHA) return true;
    return false;
  };
  if (side === 'left') {
    for (let x = 0; x < w; x++) if (inked(x)) return (x - penX) / s;
  } else {
    for (let x = w - 1; x >= 0; x--) if (inked(x)) return (x + 1 - penX) / s;
  }
  return null;
}

// Refine the conservative measured ink box against the painted truth. Bounds
// stay pen-origin-relative in the actualBoundingBox sign convention (left is
// positive going LEFT). Null = no rasterizer here; keep the measured bounds.
function probeInkEdges(
  value: string,
  declAt: (px: number) => string,
  fontSize: number,
  letterSpacingPx: number,
  measuredLeft: number,
  measuredRight: number,
): { left: number; right: number } | null {
  if (value.trim().length === 0) return null;
  const ctx = getProbeCtx();
  if (!ctx) return null;
  const edge = (side: 'left' | 'right', conservative: number): number =>
    probeEdge(ctx, value, declAt, fontSize, letterSpacingPx, side, conservative, PROBE_STRIP_EM) ??
    probeEdge(
      ctx,
      value,
      declAt,
      fontSize,
      letterSpacingPx,
      side,
      conservative,
      PROBE_WIDE_STRIP_EM,
    ) ??
    conservative;
  return {
    left: -edge('left', -measuredLeft),
    right: edge('right', measuredRight),
  };
}

function measureTextSegment(
  value: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  declAt: (px: number) => string,
  letterSpacingPx: number,
  // False = advance-only: skip the whole bearing ladder (64x re-measure +
  // raster probe) and take the base measure's bounds as-is. For callers that
  // read nothing but `.advance` — measureAdvance sits UNCACHED on per-frame
  // paths (justify positions every word/space per render), where the ladder
  // is pure waste. Advances are identical either way by design.
  inkBearings = true,
): { advance: number; bearingLeft: number; bearingRight: number; trailing: number } {
  if (value.length === 0) return { advance: 0, bearingLeft: 0, bearingRight: 0, trailing: 0 };
  if (measureCtx) {
    const tracking = (px: number) =>
      ((measureCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${px}px`);
    measureCtx.font = declAt(fontSize);
    // Chromium's canvas honors letterSpacing (added after each character,
    // matching SVG letter-spacing); environments without the property just
    // measure untracked.
    // Whether it was honored decides `trailing` below: an environment that
    // measures untracked has no trailing step to discount.
    const tracked = 'letterSpacing' in measureCtx;
    if (tracked) tracking(letterSpacingPx);
    const tm = measureCtx.measureText(value);
    const advance = tm.width;
    let bL = tm.actualBoundingBoxLeft ?? 0;
    let bR = tm.actualBoundingBoxRight ?? 0;
    if (inkBearings) {
      // The hi-res pass for the ink bounds (see BEARING_MEASURE_SCALE), with
      // the tracking scaled to match so interior letter-spacing widens the ink
      // box identically at both sizes.
      measureCtx.font = declAt(fontSize * BEARING_MEASURE_SCALE);
      if (tracked) tracking(letterSpacingPx * BEARING_MEASURE_SCALE);
      const hi = measureCtx.measureText(value);
      bL = (hi.actualBoundingBoxLeft ?? 0) / BEARING_MEASURE_SCALE;
      bR = (hi.actualBoundingBoxRight ?? 0) / BEARING_MEASURE_SCALE;
      // Where a rasterizer exists, refine the conservative bounds to the
      // painted truth (see the probe block above); everywhere else the hi-res
      // measure stands.
      const probed = probeInkEdges(value, declAt, fontSize, letterSpacingPx, bL, bR);
      if (probed) {
        bL = probed.left;
        bR = probed.right;
      }
    }
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
        trailing: tracked ? letterSpacingPx : 0,
      };
    }
    if (advance > 0) {
      // Real canvas advance but no ink bounds — treat the whole advance as ink.
      return {
        advance,
        bearingLeft: 0,
        bearingRight: advance,
        trailing: tracked ? letterSpacingPx : 0,
      };
    }
  }
  // The estimate adds one letterSpacingPx per character, the last included.
  const approx = approximateLineWidth(value, fontSize, letterSpacingPx);
  return { advance: approx, bearingLeft: 0, bearingRight: approx, trailing: letterSpacingPx };
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
  const declAt = (px: number) => `${italic ? 'italic ' : ''}${weight} ${px}px ${FONT_STACK}`;
  // Advance-only: no bearing ladder (see measureTextSegment's inkBearings).
  return measureTextSegment(text, fontSize, getCtx(), declAt, letterSpacingPx, false).advance;
}

type ParseMode = 'literal' | 'formatted';

// Drop the trailing letter-spacing step from a line's pen advance (see
// LineMetrics.alignAdvance). Only when the line advanced at all — an empty line
// has no trailing step to remove — and never past zero.
function alignAdvanceOf(cursor: number, trailing: number): number {
  return cursor > 0 ? Math.max(0, cursor - trailing) : cursor;
}

function computeLineMetrics(
  raw: string,
  fontSize: number,
  measureCtx: CanvasRenderingContext2D | null,
  declFor: (style: SegmentStyle | undefined, size: number) => string,
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
    // Blank line: no ink, but it still occupies a base-size line box so vertical
    // rhythm is preserved.
    return {
      inkWidth: 0,
      bearingLeft: 0,
      bearingRight: 0,
      advanceWidth: 0,
      alignAdvance: 0,
      maxFontSize: fontSize,
      segments: [],
      exit,
    };
  }
  // Largest resolved run size on the line drives its height. Bullets are the base
  // size (styles, incl. <size>, never attach to a bullet).
  let maxFontSize = 0;
  // The letter-spacing baked in AFTER the final glyph of each segment — 0 in
  // environments whose canvas ignores letterSpacing, so alignAdvance never
  // discounts a step that was not measured in the first place.
  const trailings: number[] = [];
  const segMetrics: SegmentMetric[] = segments.map((seg) => {
    if (seg.kind === 'bullet') {
      const d = inlineBulletDiameter(fontSize);
      if (fontSize > maxFontSize) maxFontSize = fontSize;
      trailings.push(letterSpacingPx);
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
    const segFontSize = resolveRunFontSize(fontSize, seg.style);
    if (segFontSize > maxFontSize) maxFontSize = segFontSize;
    const t = measureTextSegment(
      seg.value,
      segFontSize,
      measureCtx,
      (px) => declFor(seg.style, px),
      letterSpacingPx,
    );
    trailings.push(t.trailing);
    const { trailing: _trailing, ...tm } = t;
    return seg.style
      ? { kind: 'text', value: seg.value, style: seg.style, fontSize: segFontSize, ...tm }
      : { kind: 'text', value: seg.value, fontSize: segFontSize, ...tm };
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
      alignAdvance: alignAdvanceOf(cursor, trailings[trailings.length - 1] ?? 0),
      maxFontSize,
      segments: segMetrics,
      exit,
    };
  }
  return {
    inkWidth: inkRight - inkLeft,
    bearingLeft: -inkLeft,
    bearingRight: inkRight,
    advanceWidth: cursor,
    alignAdvance: alignAdvanceOf(cursor, trailings[trailings.length - 1] ?? 0),
    maxFontSize,
    segments: segMetrics,
    exit,
  };
}

/**
 * Greedily word-wrap one paragraph to `width`, returning each wrapped line
 * with the open-tag state it starts under (so committed lines can be
 * re-measured/rendered with the right entry style). The paragraph's LEADING
 * whitespace is the author's indent: it rides the first word onto the first
 * wrapped line and its advance counts toward the wrap width (typed spaces
 * measure as real width — see the whitespace bearing corrections). Interior
 * whitespace runs collapse to single-space gaps; a word wider than the
 * column lands on its own (overflowing) line — no mid-word hyphenation. An
 * empty or all-whitespace paragraph yields a single blank line so vertical
 * spacing is preserved.
 */
function wrapParagraph(
  paragraph: string,
  width: number,
  measure: (s: string, entry: InlineStyleState | null) => ParsedLine,
  entry: InlineStyleState | null,
): { raw: string; entry: InlineStyleState | null }[] {
  const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [{ raw: '', entry }];
  const lead = /^\s*/.exec(paragraph)![0];
  if (lead.length > 0) words[0] = lead + words[0];
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
 * parse formatting tags, whose styles change per-segment font weight/style/size);
 * widths combine the canvas `measureText` (or a fontSize-based approximation
 * when no real canvas is available) with the inline-bullet diameter and any
 * tracking. Each line is as tall as its largest run (an inline `<size=…>` grows
 * or shrinks that line and the box), and the total height sums the per-line
 * heights with leading-scaled spacing. Returned values are cached by
 * content+style.
 *
 * Both `TextLabel` and station-name renderers can pass themselves here —
 * `StyledText` is the structural subset of fields the measurer uses.
 */
export function measureTextLabel(styled: StyledText): MeasuredBBox {
  const key = cacheKey(styled);
  const hit = cache.get(key);
  if (hit) return hit.bbox;

  const measureCtx = getCtx();
  const mode: ParseMode = styled.literalBullets ? 'literal' : 'formatted';
  const letterSpacingPx = (styled.tracking ?? 0) * styled.fontSize;
  // Measure with the SAME stack the canvas renders (incl. the symbol fallback),
  // so a symbol's measured advance matches its drawn advance — otherwise the
  // inline-bullet cursor spaces it against the wrong (system-fallback) width.
  // Per-segment: a <w=…>/<b>/<i> tag bumps the weight/style and a <size=…> tag the
  // size for that run only (the caller resolves the run size and passes it in).
  // Every face this measurement REQUESTS, collected as it goes — the whole
  // bearing ladder and the raster probe run through this one closure, so it
  // sees each run's real weight/style including inline-tag overrides. What CSS
  // matching then serves is not observable here; see invalidateMeasuredFaces
  // for why the two must not be allowed to diverge.
  const usedFaces = new Set<string>();
  const declFor = (style: SegmentStyle | undefined, size: number): string => {
    const w = resolveRunWeight(styled.weight, style);
    const it = styled.italic || style?.italic;
    usedFaces.add(faceKey(w, !!it));
    return `${it ? 'italic ' : ''}${w} ${size}px ${FONT_STACK}`;
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
    // baselineFromTop needs every line's maxFontSize, so it's a placeholder here
    // and filled by the cumulative pass below.
    lineMetrics.push({
      ...ink,
      raw,
      endsParagraph,
      baselineFromTop: 0,
      ...(entry ? { entryStyle: entry } : {}),
    });
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
  // Variable line height: each line is one LINE_HEIGHT of its own largest run's
  // size, so a bigger inline <size> grows the box and pushes neighbours apart and
  // a smaller line pulls in. Lay baselines out cumulatively (line 0 sits
  // BASELINE_FRACTION of its size below the top; each next line advances by its
  // own maxFontSize * LINE_HEIGHT, leading-scaled); the box bottom clears the
  // last line's descent. Reduces exactly to the historical
  // fontSize * LINE_HEIGHT * (1 + (lineCount - 1) * leading) when every line is
  // the base size.
  const lead = styled.leading ?? 1;
  let baseline = 0;
  lineMetrics.forEach((lm, i) => {
    baseline =
      i === 0 ? BASELINE_FRACTION * lm.maxFontSize : baseline + lm.maxFontSize * LINE_HEIGHT * lead;
    lm.baselineFromTop = baseline;
  });
  const last = lineMetrics[lineMetrics.length - 1];
  const height = last.baselineFromTop + (LINE_HEIGHT - BASELINE_FRACTION) * last.maxFontSize;
  const result: MeasuredBBox = {
    width: boxWidth,
    height,
    lineCount: lineMetrics.length,
    lineWidths,
    lines: lineMetrics,
  };

  if (cache.size >= TEXT_MEASURE_CACHE_LIMIT) {
    // Drop oldest entry (Map preserves insertion order).
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { bbox: result, faces: usedFaces });
  return result;
}

/**
 * Per-line start cursor (pen origin) X in the box's centered frame. Lines
 * align by their PEN advance, not by raw ink, so they flush on the font's
 * designed side bearings and read even. Aligning by ink instead pins each
 * line's leftmost/rightmost ink *pixel* to the bbox edge, which shoves
 * round/hooked initials (o, c, w, f, v, s…) visibly inward — the ragged,
 * letter-shape-dependent edge this replaced. Shared by the renderer
 * (LabelView) and the alignment-box extent below, so paint and box cannot
 * drift. `justify` takes the default branch: its ragged last line is
 * left-flush, and its stretched lines never call this.
 */
export function lineCursorX(
  align: TextLabelAlign,
  halfWidth: number,
  advanceWidth: number,
): number {
  if (align === 'right') return halfWidth - advanceWidth;
  if (align === 'center') return -advanceWidth / 2;
  // left (and justify's ragged last line)
  return -halfWidth;
}

/**
 * The block's horizontal INK extent in the box's centered frame, or null when
 * no rendered line carries ink. Lines are POSITIONED by pen advance (see
 * {@link lineCursorX}), so the pen box and the ink disagree by the end glyphs'
 * side bearings — a proportional empty strip when a box drawn on the pen
 * extent claims to hug the ink. Each line contributes its true ink span
 * (cursor ± bearings); an interior justified line with a gap to stretch is
 * pen-flush to both box edges instead (justifyLine widens only the gaps, so
 * its end insets are stretch-invariant).
 */
export function blockInkExtentX(
  m: MeasuredBBox,
  align: TextLabelAlign,
): { left: number; right: number } | null {
  const halfW = m.width / 2;
  let left = Infinity;
  let right = -Infinity;
  for (const lm of m.lines) {
    if (lm.segments.length === 0) continue;
    // A line is only stretched when justifyLine actually stretches it, and it
    // BAILS on a line with no slack (labelJustify's `slack <= 0`) — which in
    // Auto mode is the widest line every time, since the box hugs its INK while
    // the slack is measured against its longer PEN advance. Such a line
    // left-flushes like a ragged one, so boxing it pen-flush would leave the
    // right edge short of the paint by the end glyphs' side bearings.
    const stretched =
      align === 'justify' &&
      !lm.endsParagraph &&
      m.width > lm.alignAdvance &&
      /\s/.test(lm.raw.trim());
    const cursor = lineCursorX(align, halfW, lm.alignAdvance);
    const l = stretched ? -halfW - lm.bearingLeft : cursor - lm.bearingLeft;
    const r = stretched ? halfW - (lm.alignAdvance - lm.bearingRight) : cursor + lm.bearingRight;
    if (l < left) left = l;
    if (r > right) right = r;
  }
  return Number.isFinite(left) ? { left, right } : null;
}

/** Test/dev hook: clear the measurement cache (used by tests). */
export function _clearTextMeasureCache(): void {
  cache.clear();
}
