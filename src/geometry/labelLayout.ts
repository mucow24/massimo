import type { DotBaseShape, Station, StopCell, StopOrientation } from '../model/types';
import {
  BAND_MERGE_TOL,
  DIR_8,
  labelAdjacencyGate,
  STOP_SIZE,
  stopCenterAt,
  travelDirLocal,
  worldDirToLocal,
  type Rotation,
} from './orientation';
import { DIRS_8, dirIndex } from './router';
import type { Vec2 } from './vec';
import { dashOutward } from './stationDash';
import {
  BASELINE_FRACTION,
  CAP_FRACTION,
  DESCENDER_FRACTION,
  LINE_HEIGHT,
  capCenterDy,
  measureTextLabel,
} from './textMeasure';

const HIT_PAD = 2;
const LABEL_GAP = 3;
const HALF = STOP_SIZE / 2;

/**
 * Everything the label geometry needs to know about ONE painted stop.
 *
 * Production callers pass `stopMetricsOf({ lines, transfers })`
 * (model/stopMetrics.ts) at EVERY `labelLayoutLocal` / `stationBoundary` /
 * `itemBounds` site — renderer and hit/bounds geometry alike — or the painted
 * label drifts off its own hit rect. The fields travel as one bundle precisely
 * so a site cannot pass four of five and silently disagree with the paint; they
 * were separate lookups once, and keeping them in step was manual.
 */
export interface StopMetrics {
  /** Half the stop's line width. The marker square is this half-extent rotated
   *  to the stop's travel axis. */
  half: number;
  /** How much the stop's line widens its packed pitch against a neighbor. Read
   *  ONLY by the adjacency gate — a label parked by the ghost lattice against a
   *  gapped line sits at tangency + gap and must still count as attached. It
   *  never widens a pin: the gap is empty space, not marker body. */
  gap: number;
  /** TfL tick length/width, or null when this stop paints no tick. */
  dash: { length: number; width: number } | null;
  /** The painted dot's OUTER silhouette — `r` already includes the stroke
   *  outset — or null when the stop paints no dot (a blank style, or a 'dash',
   *  whose tick is `dash` above). A dot can be WIDER than its own line, so this
   *  is a real obstacle and not a subset of `half`. Deliberately NOT rotated to
   *  the travel axis: StopGlyph draws it axis-aligned in the station frame,
   *  unlike the stripe. */
  dot: { r: number; shape: DotBaseShape } | null;
  /** Radius of the largest transfer cap landing on this stop, 0 when none. A
   *  transfer is a round-capped capsule of uniform half-width, so at its end it
   *  is exactly a disc — isotropic, needing no direction. */
  transferRadius: number;
}

/**
 * Per-stop metrics lookup. Takes the whole `station`, not just the stop,
 * because three of the five fields need more than the cell: the split
 * singleton/interchange dot default is a property of the station's stop SET
 * (blank-aware, see `stationIsSingleton`), and a transfer end names its
 * station.
 */
export type StopMetricsFn = (station: Station, stop: StopCell) => StopMetrics;

/** The pre-feature pin: uniform stripe half, no gap, and blind to ticks, dots
 *  and transfers. Tests and non-doc callers fall back to it. */
export const DEFAULT_STOP_METRICS: StopMetricsFn = () => ({
  half: HALF,
  gap: 0,
  dash: null,
  dot: null,
  transferRadius: 0,
});

export type LabelBaseline = 'central' | 'text-before-edge' | 'text-after-edge';

/**
 * Rendered font metrics for a station label. Threaded into the layout so the
 * hit rect / wash silhouette width is measured against the *actual* glyphs
 * (font size, weight, inline route-bullet circles) rather than a per-character
 * guess. The default mirrors the historical 12px Regular assumption so callers
 * that don't care about exact width (and the unit tests) keep working.
 */
export interface LabelStyle {
  fontSize: number;
  weight: number;
  italic: boolean;
  /**
   * Size the box against the literal `|CODE|` text instead of the collapsed
   * bullets. Set by the inline rename editor so its box fits the raw tokens
   * the textarea shows. Only affects width (the hit rect / textXMin); the
   * anchor, baseline, and height are bullet-independent.
   */
  literalBullets?: boolean;
  /**
   * Global station-label line-spacing multiplier (default 1). Scales the
   * between-line stacking so the hit rect / wash silhouette height matches the
   * leaded renderer; a single line's height is unaffected.
   */
  leading?: number;
  /**
   * Global station-label letter-spacing in em (default 0). Threaded into the
   * measurement so the box width hugs the tracked glyphs.
   */
  tracking?: number;
}

export const DEFAULT_LABEL_STYLE: LabelStyle = { fontSize: 12, weight: 400, italic: false };

export interface LabelLayout {
  // Anchor point of the rendered <text> element in unrotated station-local
  // coords. The label's `rotation` is applied around this point at render
  // time.
  anchorX: number;
  anchorY: number;
  // SVG attribute value: which side of the anchor the text aligns to.
  textAnchor: 'start' | 'middle' | 'end';
  // Which vertical edge of the first line lands on `anchorY` — its top
  // ('text-before-edge'), centre ('central'), or bottom ('text-after-edge').
  // NOT written to the DOM: the renderer converts it into an explicit
  // alphabetic baseline y (see stationLabelText's firstLineBaselineY). The
  // names stay because they read as the geometry, and the mapping to the SVG
  // modes of the same name is exactly what the model assumes them to mean.
  baseline: LabelBaseline;
  // First-line baseline shift in px (negative = up), shifting a multi-line
  // block so `valign` refers to the BLOCK, not just the first line. Subsequent
  // lines stack by the leading-scaled line height (`lineStackPx`). 0 = no shift.
  firstLineDyPx: number;
  // Tight box around the rendered text in unrotated station-local coords,
  // padded by HIT_PAD on each side. Used by:
  //  - the bg hit-test rect (rotated about (anchorX, anchorY) for hit-testing)
  //  - the wash/stroke silhouette polygon (rotated for the union path)
  hitX: number;
  hitY: number;
  hitW: number;
  hitH: number;
  // Top of the painted text block (no HIT_PAD) — the same edge `hitY` pads.
  // Kept as the block's own geometry, which the valign tests read; the paint
  // path derives everything from firstLineCenterY instead.
  blockTopY: number;
  // Visual center y of the first text line, already folding in the valign AND
  // the multi-line first-line shift. THE number the renderer takes: both paint
  // paths put line i's alphabetic baseline at
  // firstLineCenterY + fontSize*(BASELINE_FRACTION - 0.5) + i*lineSpacing.
  // Measured from the line's center, never an edge — labelLayout works in a
  // 1.2em LINE box while BASELINE_FRACTION measures down from the 1.0em EM box
  // top, and the two share a center but not their top/bottom edges (0.1em of
  // half-leading sits at each end). `baseline`/`firstLineDyPx` name those edges,
  // which is why the renderer is not given them.
  firstLineCenterY: number;
}

/**
 * Single source of truth for label placement. Mirrors what `StationView`
 * paints; consumed by both the renderer and the selection/hit geometry so
 * the wash silhouette and the hit rect always agree with the visible text.
 */
export function labelLayoutLocal(
  station: Station,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  // Injected for deterministic tests; defaults to the real (canvas-backed)
  // measurer so production callers are unaffected. Under jsdom the default
  // falls back to a width heuristic, which is why exact-geometry tests pass a
  // stub instead of trusting it.
  measure: typeof measureTextLabel = measureTextLabel,
  // Per-stop metrics lookup. Renderer (StationLabel) and hit geometry
  // (stationBoundary) MUST pass the same lookup or the wash/hit rect drifts off
  // the painted text next to any stop that isn't plain default width.
  metrics: StopMetricsFn = DEFAULT_STOP_METRICS,
): LabelLayout {
  const stops = station.stops;
  const label = station.label;
  const phantomDot = stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  const labelCenter = stopCenterAt(label.row, label.col);
  const dirPlus = DIR_8[label.rotation];
  const dirMinus = DIR_8[(label.rotation + 4) % 8];

  const readAngle = (label.rotation * Math.PI) / 4;
  const readCos = Math.cos(readAngle);
  const readSin = Math.sin(readAngle);

  // Measured before the alignment branch because autoAlign needs per-line
  // advances (its H/V overrides slide the anchor by the anchor line's
  // width); the width also sizes the hit rect below. Measurement is
  // bullet-aware (a `<CODE>` token measures as one small circle, not as its
  // literal characters) and font-size-aware, so the hit rect / wash
  // silhouette hugs the painted glyphs instead of a per-character guess.
  const nameLines = station.name.split('\n');
  const extraLines = nameLines.length - 1;
  const measured = measure({
    text: station.name,
    fontSize: style.fontSize,
    weight: style.weight,
    // `style` is already the station's effective typography (callers pass
    // effectiveStationLabelStyle(station)), so italic is resolved here.
    italic: style.italic,
    literalBullets: style.literalBullets,
    // Station names parse the full inline grammar (bullets + formatting tags),
    // so a "<b>Foo</b>" name measures at its rendered bold-"Foo" width, not the
    // literal tag characters — the hit rect / wash silhouette then hugs the
    // painted glyphs (matches renderStationLabelText). The edit box still forces
    // the raw-token width via `literalBullets` above.
    // Global leading/tracking: tracking widens the measured ink; leading feeds
    // the height math below (measureTextLabel returns a leaded height too, but
    // the vertical metrics here are derived independently).
    leading: style.leading,
    tracking: style.tracking,
  });

  // A waypoint never paints its own dot or tick — hidden it paints nothing;
  // revealed, the overlay replaces every stop style with a fixed circle
  // (StationDots' wpOverride) — so its pin must clear neither. Gated on
  // isWaypoint alone (not the view toggle) so layout never shifts with the
  // Show-waypoints overlay. The stripe, the gap and any transfer cap still
  // count: those paint whatever the overlay does.
  const stopMetrics: StopMetricsFn = station.isWaypoint
    ? (st, s) => ({ ...metrics(st, s), dash: null, dot: null })
    : metrics;

  let textAnchor: 'start' | 'middle' | 'end' = 'middle';
  let anchorX = labelCenter.x;
  let anchorY = labelCenter.y;
  // autoAlign derives the block behavior too; the other modes keep the
  // stored valign. All downstream vertical math reads this local.
  let valign = label.valign;

  if (label.autoAlign) {
    // Smart placement (transitmap.net rules) — overrides align AND valign.
    // Lines align by pen advance (see textMeasure), with the jsdom/stub
    // fallbacks the rest of the file uses.
    const lineAdvances = nameLines.map(
      (_, i) => measured.lines[i]?.alignAdvance ?? measured.lineWidths[i] ?? measured.width,
    );
    const info = autoAlignInfo(
      station,
      phantomDot,
      readCos,
      readSin,
      style.fontSize,
      stopMetrics,
      lineAdvances,
    );
    textAnchor = info.textAnchor;
    valign = info.valign;
    anchorX = labelCenter.x + info.anchorRead * readCos - info.anchorPerp * readSin;
    anchorY = labelCenter.y + info.anchorRead * readSin + info.anchorPerp * readCos;
  } else if (label.align === 'start' || label.align === 'middle' || label.align === 'end') {
    // Explicit alignment: anchor stays at cell center, only text-anchor
    // changes.
    textAnchor = label.align;
  } else {
    // 'auto' (or unset): snap whenever a stop sits in the reading-direction
    // HALF-plane around the label cell — not just the strictly-adjacent cell
    // along the reading axis. This covers diagonal-reading labels with
    // cardinal-adjacent stops (and vice versa); without it, a NE-reading
    // label with a W-adjacent stop drops to centered placement and the
    // text floats off in space.
    //
    // Each of the 8 surrounding cells is classified by sign of its dot
    // product with the reading direction: > 0 = ahead, < 0 = behind, = 0
    // (perpendicular) doesn't snap. The 0 threshold is safe because in the
    // 8-cell grid the smallest non-zero |dot| is ~0.707; perpendicular
    // cells are exactly 0 (mod fp noise).
    const plus = snapInfoInHalfPlane(station, phantomDot, readCos, readSin, 1, stopMetrics);
    const minus = snapInfoInHalfPlane(station, phantomDot, readCos, readSin, -1, stopMetrics);
    if (plus.inHalfPlane) {
      textAnchor = 'end';
      anchorX = labelCenter.x + dirPlus.anchor.x - LABEL_GAP * readCos;
      anchorY = labelCenter.y + dirPlus.anchor.y - LABEL_GAP * readSin;
      // Stop-relative placement override. When a stop sits in the text's
      // perpendicular envelope (not just diagonally off-axis), place the
      // anchor at exactly HALF + LABEL_GAP behind the stop along reading.
      // The dirPlus.anchor heuristic places the anchor at the label cell's
      // boundary — for cardinal rotations that's an edge midpoint (HALF
      // from labelCenter along reading), for diagonal rotations it's a
      // corner (HALF*√2 ≈ 9.9 from labelCenter along reading). That ~2.9-
      // unit asymmetry shows up as inconsistent gaps between cardinal and
      // diagonal labels next to the same stop. Stop-relative placement
      // pins the gap to the stop, so the visual spacing matches.
      if (plus.inWayStopProj !== null) {
        // `proj * STOP_SIZE` stays — the projection is in lattice units and
        // the lattice does NOT scale with width; only the stop's own
        // half-extent does.
        const target = plus.inWayStopProj * STOP_SIZE - ((plus.inWayStopHalf ?? HALF) + LABEL_GAP);
        anchorX = labelCenter.x + target * readCos;
        anchorY = labelCenter.y + target * readSin;
      }
    } else if (minus.inHalfPlane) {
      textAnchor = 'start';
      anchorX = labelCenter.x + dirMinus.anchor.x + LABEL_GAP * readCos;
      anchorY = labelCenter.y + dirMinus.anchor.y + LABEL_GAP * readSin;
      if (minus.inWayStopProj !== null) {
        const target =
          minus.inWayStopProj * STOP_SIZE + ((minus.inWayStopHalf ?? HALF) + LABEL_GAP);
        anchorX = labelCenter.x + target * readCos;
        anchorY = labelCenter.y + target * readSin;
      }
    }
  }

  // 'auto-down', 'auto-up', and 'middle' all use central baseline; they differ
  // in how multi-line blocks are shifted relative to the anchor (see
  // firstLineDy / blockTopY below).
  let baseline: LabelBaseline = 'central';
  if (valign === 'top') baseline = 'text-before-edge';
  else if (valign === 'bottom') baseline = 'text-after-edge';

  if (label.offset) {
    anchorX += label.offset * readCos;
    anchorY += label.offset * readSin;
  }
  // Perpendicular offset: positive moves the anchor in the `(-readSin,
  // readCos)` direction — same axis used by snapInfoInHalfPlane's `perp`,
  // i.e. the side a new line of text would stack onto. Visually "down" for
  // a rotation=0 (E-reading) label, "left" for rotation=2 (S-reading), etc.
  const offsetPerp = label.offsetPerp ?? 0;
  if (offsetPerp) {
    anchorX += offsetPerp * -readSin;
    anchorY += offsetPerp * readCos;
  }

  // Hit rect in unrotated local coords, *before* the label.rotation rotation
  // is applied to it.
  const textW = Math.max(20, measured.width);

  // Vertical metrics derived from the rendered font size, using the same
  // LINE_HEIGHT ratio the renderer stacks lines by. A single line's block is
  // one line height; half a line height is the central-baseline half-extent.
  // This keeps the hit rect / wash silhouette height equal to
  // measureTextLabel's height at any font size, instead of the old constants
  // (7 / 14) that were tuned for a fixed ~12px font.
  //
  // Leading scales only the BETWEEN-line stacking (`lineStackPx`), not the
  // single line's own half-extent (`textHalfH`): a one-line block is one
  // line-height tall at any leading, exactly like measureTextLabel's height
  // (fontSize*LINE_HEIGHT*(1 + extraLines*leading)).
  const lineHeight = style.fontSize * LINE_HEIGHT;
  const textHalfH = lineHeight / 2;
  const lineStackPx = lineHeight * (style.leading ?? 1);

  let textXMin: number;
  if (textAnchor === 'start') textXMin = anchorX;
  else if (textAnchor === 'end') textXMin = anchorX - textW;
  else textXMin = anchorX - textW / 2;

  // Vertical alignment, in BLOCK terms for top/middle/bottom and in
  // FIRST-/LAST-LINE terms for auto-down/auto-up: 'top' puts the block top at
  // the anchor, 'middle' centers the block, 'bottom' puts the block bottom at
  // the anchor, 'auto-down' keeps the first line's center on the anchor with
  // the rest of the block extending below it, 'auto-up' keeps the last line's
  // center on the anchor with earlier lines stacking above it. We achieve this
  // by shifting only the first line up; subsequent tspans stack by `lineStackPx`
  // below it. The anchor itself stays on the L cell so rotation still
  // pivots there.
  //
  // Lines stack down by `lineStackPx` (fontSize * LINE_HEIGHT * leading).
  // The block's height is `2*textHalfH + extraLines*lineStackPx`. The
  // first line's natural y given the dominant baseline is:
  //   - 'text-before-edge': first line top   = anchorY
  //   - 'central'         : first line center= anchorY  (top = anchorY - textHalfH)
  //   - 'text-after-edge' : first line bottom= anchorY  (top = anchorY - lineHeight)
  // To put the BLOCK at the desired position relative to anchorY, shift the
  // first line up by:
  //   - top      : 0
  //   - auto-down: 0  (first line center already at anchorY via central baseline)
  //   - middle   : extraLines * lineStackPx / 2
  //   - bottom   : extraLines * lineStackPx
  //   - auto-up  : extraLines * lineStackPx  (lifts the first line so the LAST
  //                line lands at anchorY; matches 'bottom' but offset by half
  //                a text body, which the blockTopY math below accounts for)
  let firstLineShiftPx = 0;
  if (valign === 'middle') firstLineShiftPx = (extraLines * lineStackPx) / 2;
  else if (valign === 'bottom' || valign === 'auto-up') firstLineShiftPx = extraLines * lineStackPx;
  // First-line baseline shift in px (negative = up). The renderer applies the
  // per-line stacking in px too, so no em round-trip is needed.
  const firstLineDyPx = firstLineShiftPx === 0 ? 0 : -firstLineShiftPx;

  // Top of the painted text block (already accounting for the first-line
  // shift above):
  //   - top      : block top at anchorY
  //   - auto-down: first line top at anchorY - textHalfH, block grows down
  //                (block top stays put as lines are added)
  //   - middle   : half a block-height above anchorY
  //   - bottom   : a full block-height above anchorY
  //   - auto-up  : last line bottom at anchorY + textHalfH, block grows up
  //                (block bottom stays put as lines are added) — i.e. block
  //                top at anchorY - textHalfH - extraLines*lineStackPx
  const blockH = 2 * textHalfH + extraLines * lineStackPx;
  let textYMin: number;
  if (valign === 'top') textYMin = anchorY;
  else if (valign === 'bottom') textYMin = anchorY - blockH;
  else if (valign === 'auto-down') textYMin = anchorY - textHalfH;
  else if (valign === 'auto-up') textYMin = anchorY - textHalfH - extraLines * lineStackPx;
  else textYMin = anchorY - blockH / 2;

  // First-line visual center, derived from the block-top + half a text body.
  // Equivalent to (first line top + textHalfH). The block-top math already
  // encodes the valign semantics; adding textHalfH walks down to the line's
  // center.
  const firstLineCenterY = textYMin + textHalfH;

  return {
    anchorX,
    anchorY,
    textAnchor,
    baseline,
    firstLineDyPx,
    hitX: textXMin - HIT_PAD,
    hitY: textYMin - HIT_PAD,
    hitW: textW + 2 * HIT_PAD,
    hitH: blockH + 2 * HIT_PAD,
    blockTopY: textYMin,
    firstLineCenterY,
  };
}

interface SnapInfo {
  // Any adjacent stop on `sign`'s side of the reading direction? Drives
  // the snap-or-don't decision.
  inHalfPlane: boolean;
  // Projection (in cell-space, along reading dir, from the label cell) of
  // the closest stop on `sign`'s side that ALSO sits within the label's
  // perpendicular text envelope. Used by the caller to clamp the snap
  // anchor away from a stop that would otherwise collide with the text.
  // Null when no such stop exists — e.g. diagonal-off-axis stops still
  // trigger `inHalfPlane` (so the snap fires) but don't push the anchor
  // out, because the text naturally clears them.
  inWayStopProj: number | null;
  // The winning in-way stop's half-extent (world units) — the anchor clamp
  // clears the stop's ACTUAL edge, not the default STOP_SIZE/2. Null
  // whenever `inWayStopProj` is null.
  inWayStopHalf: number | null;
}

/**
 * Walk the label's neighbors once and collect: whether *any* stop falls in
 * the given half-plane (the snap-fires bit), and the projection of the
 * stop that the text most needs to clear (the anchor-clamp bit). `sign` is
 * +1 for "ahead of reading" (dirPlus) or -1 for "behind" (dirMinus).
 */
function snapInfoInHalfPlane(
  station: Station,
  phantomDot: { row: number; col: number } | null,
  readCos: number,
  readSin: number,
  sign: 1 | -1,
  metrics: StopMetricsFn,
): SnapInfo {
  const stops = station.stops;
  const label = station.label;
  // Perpendicular gate in cell-space: HALF / STOP_SIZE = 0.5. A stop with
  // |perp| > this sits outside the text's perpendicular envelope, so the
  // text naturally clears it and no anchor clamp is needed. Intentionally
  // NOT width-scaled: it gates on the TEXT's perpendicular extent (a font
  // metric in label-cell units), not on the stop's body.
  const PERP_GATE = 0.5;
  let inHalfPlane = false;
  let inWayStopProj: number | null = null;
  let inWayStopHalf: number | null = null;
  const consider = (dRow: number, dCol: number, half: number, gap: number) => {
    // Accept any cell within the adjacency gate (see labelAdjacencyGate).
    if (Math.max(Math.abs(dRow), Math.abs(dCol)) > labelAdjacencyGate(half, gap)) return;
    const proj = dCol * readCos + dRow * readSin;
    if (sign * proj <= 1e-6) return;
    inHalfPlane = true;
    // Perpendicular (CCW 90° from reading): (-readSin, readCos).
    const perp = dCol * -readSin + dRow * readCos;
    if (Math.abs(perp) > PERP_GATE) return;
    // Track the in-way stop NEAREST the label cell along reading. The text is
    // end/start-anchored and extends back toward the cell, so the nearest stop
    // imposes the tighter anchor bound — clamping behind it clears every stop
    // farther along, whereas clamping behind a farther stop would leave the
    // nearer one sitting under the text. The `sign * proj <= 1e-6` gate above
    // guarantees `sign * proj > 0` (the positive distance along reading), so
    // "nearest" is simply the smallest `sign * proj`.
    if (inWayStopProj === null || sign * proj < sign * inWayStopProj) {
      inWayStopProj = proj;
      inWayStopHalf = half;
    }
  };
  for (const s of stops) {
    const m = metrics(station, s);
    consider(s.row - label.row, s.col - label.col, m.half, m.gap);
  }
  if (phantomDot) consider(phantomDot.row - label.row, phantomDot.col - label.col, HALF, 0);
  return { inHalfPlane, inWayStopProj, inWayStopHalf };
}

interface AutoAlignInfo {
  textAnchor: 'start' | 'middle' | 'end';
  // Anchor point in the READING frame, relative to the label cell center:
  // along the reading direction and its perpendicular. The caller rotates
  // these back into unrotated station-local coords.
  anchorRead: number;
  anchorPerp: number;
  // Which block behavior realizes the vertical mode. By default the line
  // NEAREST the marker gets the typography and extra lines stack away from
  // it: sit-on-baseline above = 'auto-up' (last line pinned, grows up);
  // hang-from-cap below = 'auto-down' (first line pinned, grows down);
  // beside/fallback = 'auto-down' with the FIRST line's Core Type Area
  // centered on the pin ("away" is ambiguous beside the line — align-down
  // keeps the first line level with the dot as lines are added).
  // `label.autoVAlign` overrides the choice of anchor line.
  valign: 'auto-up' | 'auto-down';
}

// Fraction of a line's advance that sits LEFT of the anchor point for each
// text-anchor value. Used to slide anchorX when `autoHAlign` re-aligns the
// block, so the ANCHOR LINE's pinned edge stays exactly where the octant
// put it.
const ANCHOR_FRACTION = { start: 0, middle: 0.5, end: 1 } as const;

/**
 * Apply the user's optional H/V overrides to the octant-derived defaults.
 * `autoVAlign` picks which line is the anchor line ('down' = top line,
 * block grows down; 'up' = bottom line, grows up) — the octant's
 * typographic fold in `anchorPerp` applies to whichever line sits at the
 * anchor, so no perpendicular change is needed. `autoHAlign` re-aligns the
 * lines WITHIN the block: anchorRead slides by the anchor line's advance so
 * that line's pinned edge doesn't move (single-line labels render
 * identically under any H value).
 */
function applyAutoOverrides(
  label: Station['label'],
  textAnchorDefault: AutoAlignInfo['textAnchor'],
  valignDefault: AutoAlignInfo['valign'],
  anchorRead: number,
  anchorPerp: number,
  lineAdvances: number[],
): AutoAlignInfo {
  const valign =
    label.autoVAlign === 'up'
      ? 'auto-up'
      : label.autoVAlign === 'down'
        ? 'auto-down'
        : valignDefault;
  const textAnchor = label.autoHAlign ?? textAnchorDefault;
  if (textAnchor !== textAnchorDefault) {
    const anchorLineIdx = valign === 'auto-up' ? lineAdvances.length - 1 : 0;
    const w = lineAdvances[anchorLineIdx] ?? 0;
    anchorRead += (ANCHOR_FRACTION[textAnchor] - ANCHOR_FRACTION[textAnchorDefault]) * w;
  }
  return { textAnchor, anchorRead, anchorPerp, valign };
}

// textAnchor per octant of the label relative to the reference stop
// (0=E … 7=NE, reading frame, y-down): the end of the text facing the stop
// aligns to it; N/S center on it.
const AUTO_TEXT_ANCHOR: AutoAlignInfo['textAnchor'][] = [
  'start', // 0 E
  'start', // 1 SE
  'middle', // 2 S
  'end', // 3 SW
  'end', // 4 W
  'end', // 5 NW
  'middle', // 6 N
  'start', // 7 NE
];

// Cell-space slack for "same row as the reference stop": the shared
// band-merge tolerance, the same 0.5 world units the packing and merge gates
// treat as one position.
const CROSS_PERP_TOL = BAND_MERGE_TOL / STOP_SIZE;

/**
 * Support function of a painted stop dot along a STATION-LOCAL unit direction —
 * how far its silhouette reaches that way. 0 when the stop paints no dot.
 *
 * Per shape rather than by one circumscribing radius, because the two polygon
 * shapes are narrow in opposite directions and a single radius would over-clear
 * one of them by √2:
 *   circle   isotropic — r whichever way you look
 *   square   axis-aligned, half-side r: widest across its diagonals
 *   diamond  vertices at r on the axes: widest along them, narrow diagonally
 *   x        a saltire inside the same 2r box as 'square', so the square's
 *            support bounds it — exact on the cardinals, generous on the
 *            diagonals, and generous only ever over-clears
 */
function dotSupport(dot: StopMetrics['dot'], ux: number, uy: number): number {
  if (!dot) return 0;
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  if (dot.shape === 'circle') return dot.r;
  if (dot.shape === 'diamond') return dot.r * Math.max(ax, ay);
  return dot.r * (ax + ay);
}

/**
 * The stop of a CROSSING line packed beside `ref` — same reading-frame row
 * (within CROSS_PERP_TOL), a different travel axis, on one side only. Its
 * stripe is what blocks a label centered on `ref`; see the call site.
 *
 * A neighbor on the same axis is a parallel line of the same corridor, not a
 * crossing, and never triggers this. Boxed in on BOTH sides (a label between
 * two crossing stripes) returns null: centering on the stop is the only
 * placement left. Distance needs no gate of its own — every candidate here
 * already passed `labelAdjacencyGate` against the label cell, which is a
 * cell-and-change away from `ref`.
 */
function crossingStop<
  T extends { proj: number; perp: number; orientation: StopOrientation | null },
>(ref: T, gated: T[]): T | null {
  if (!ref.orientation) return null;
  let ahead: T | null = null;
  let behind: T | null = null;
  for (const c of gated) {
    if (c === ref || !c.orientation || c.orientation === ref.orientation) continue;
    if (Math.abs(c.perp - ref.perp) > CROSS_PERP_TOL) continue;
    const d = c.proj - ref.proj;
    if (d > 1e-9) {
      if (!ahead || d < ahead.proj - ref.proj) ahead = c;
    } else if (d < -1e-9) {
      if (!behind || d > behind.proj - ref.proj) behind = c;
    }
  }
  if (ahead && behind) return null;
  return ahead ?? behind;
}

/**
 * transitmap.net-style placement for `autoAlign` labels. The octant of the
 * label cell relative to the nearest adjacent stop — measured in the
 * reading frame, so rotated labels follow the same rules rotated — fully
 * determines the typography: text on the upper side sits its BASELINE at
 * LABEL_GAP above the marker, text on the lower side hangs its CAP LINE at
 * LABEL_GAP below it, text beside centers its first line's Core Type Area
 * (baseline → cap height) on the stop's row, and corner octants pin the
 * facing CTA corner along the 45° approach. Multi-line blocks anchor by the
 * line nearest the marker (bottom line above, top line below, first line
 * beside) with the other lines stacking away. The pin clears the marker's actual extent
 * along the approach (the stop is a `half`-extent square rotated to its
 * travel axis; extent = its support function), so cardinal and diagonal
 * markers both get exactly LABEL_GAP of clearance.
 *
 * One exception to "the octant decides everything": at a CROSS the centering
 * octants would run the text straight through the crossing line's stripe, so
 * the reading axis re-anchors against the crossing stop (see `crossingStop`).
 */
function autoAlignInfo(
  station: Station,
  phantomDot: { row: number; col: number } | null,
  readCos: number,
  readSin: number,
  fontSize: number,
  metrics: StopMetricsFn,
  // Per-line pen advances of the rendered name, for the H/V overrides.
  lineAdvances: number[],
): AutoAlignInfo {
  const stops = station.stops;
  const label = station.label;
  // The station's own rotation — only the dash tick's on-axis tie fallback
  // reads it (dashOutward evaluates that fallback in world space).
  const stationRotation = station.rotation;
  interface Candidate extends StopMetrics {
    dRow: number;
    dCol: number;
    orientation: StopOrientation | null;
  }
  // The lookup takes the whole station so it can resolve the SAME split default
  // the canvas paints (blank-aware singleton included) — otherwise an
  // interchange-default edit would shift a singleton station's label (and vice
  // versa), and a blanked express stop would wrongly read as an interchange.
  const candidates: Candidate[] = stops.map((s) => ({
    ...metrics(station, s),
    dRow: s.row - label.row,
    dCol: s.col - label.col,
    orientation: s.orientation,
  }));
  if (phantomDot) {
    // The empty-station placeholder is not a painted stop, so it has no metrics
    // to look up: a bare default-width marker, no tick, dot or transfer.
    candidates.push({
      half: HALF,
      gap: 0,
      dash: null,
      dot: null,
      transferRadius: 0,
      dRow: phantomDot.row - label.row,
      dCol: phantomDot.col - label.col,
      orientation: null,
    });
  }

  // Gate to the label's neighbors (same gate as the legacy snap) and project
  // each into the reading frame once: both the reference pick and the
  // crossing-stop scan below read these.
  const gated = candidates
    .filter((c) => {
      const cheb = Math.max(Math.abs(c.dRow), Math.abs(c.dCol));
      if (cheb < 1e-6) return false; // a stop on the label cell has no direction
      return cheb <= labelAdjacencyGate(c.half, c.gap);
    })
    .map((c) => ({
      ...c,
      proj: c.dCol * readCos + c.dRow * readSin,
      perp: c.dCol * -readSin + c.dRow * readCos,
      d2: c.dRow * c.dRow + c.dCol * c.dCol,
    }));
  type Gated = (typeof gated)[number];

  // Reference stop: the nearest candidate within the tangency gate. Ties
  // prefer the stop below the text (larger perp), so the label sits on its
  // baseline above the line — the typographic default side.
  let ref: Gated | null = null;
  let refD2 = Infinity;
  for (const c of gated) {
    if (ref === null || c.d2 < refD2 - 1e-9 || (c.d2 < refD2 + 1e-9 && c.perp > ref.perp)) {
      ref = c;
      refD2 = Math.min(refD2, c.d2);
    }
  }
  // Center-of-line-box → baseline distance; the typographic fold-ins below
  // are expressed relative to it (see the anchor comment further down).
  const cb = (BASELINE_FRACTION - 0.5) * fontSize;

  if (ref === null) {
    // Nothing adjacent to align against: the FIRST line's Core Type Area
    // centers on the label's own cell and extra lines grow down — same
    // first-line anchoring as the beside octants, so a dragged-away label
    // doesn't re-center its block as lines are added.
    return applyAutoOverrides(
      label,
      'middle',
      'auto-down',
      0,
      capCenterDy(fontSize) - cb,
      lineAdvances,
    );
  }

  const o = dirIndex({ x: -ref.proj, y: -ref.perp });
  const u = DIRS_8[o]; // approach unit vector, stop → label, reading frame

  // Marker extent along a reading-frame unit direction, via the rotated
  // square's support function in the LOCAL frame. The phantom dot has no
  // orientation; treat it as axis-aligned (extent = half for its cardinal
  // approach).
  //
  // Every obstacle painted at the stop joins by MAX — they are concentric, so
  // the pin clears whichever reaches furthest along the approach, and each is
  // measured in the direction that actually matters rather than by a single
  // circumscribing radius.
  const extentAlong = (c: Gated, dir: Vec2): number => {
    const uLocX = dir.x * readCos - dir.y * readSin;
    const uLocY = dir.x * readSin + dir.y * readCos;
    const axis = c.orientation ? travelDirLocal(c.orientation) : { x: 1, y: 0 };
    const alongAxis = Math.abs(uLocX * axis.x + uLocY * axis.y);
    const stripe = c.half * (alongAxis + Math.abs(uLocX * -axis.y + uLocY * axis.x));
    // The dot can be WIDER than its own line — a service-code disc sizes itself
    // for legibility, and any dot size is settable — so it is a real obstacle,
    // not a subset of the stripe. Its silhouette is axis-aligned in the STATION
    // frame (StopGlyph draws it so), never rotated to the travel axis.
    const extent = Math.max(stripe, dotSupport(c.dot, uLocX, uLocY), c.transferRadius);
    if (!c.dash || !c.orientation) return extent;
    // A dash stop's tick is a second obstacle: a rect from the stripe edge
    // (± half on the label-signed perpendicular) reaching `length` toward
    // the label, `width` thick along the travel axis. Its support along the
    // approach joins the square's by max, so the pin clears whichever
    // reaches further. The side comes from the SAME offset-aware vector the
    // tick renderer uses (shared dashOutward), so a label parked on the far
    // side via offsets gets no phantom clearance — the projection goes
    // negative and the square wins. No cycle: side and octant read stored
    // fields only; this extent merely moves the painted anchor.
    const offsetPerp = label.offsetPerp ?? 0;
    const delta = {
      x: -c.dCol * STOP_SIZE + label.offset * readCos + offsetPerp * -readSin,
      y: -c.dRow * STOP_SIZE + label.offset * readSin + offsetPerp * readCos,
    };
    const out = dashOutward(delta, c.orientation, stationRotation);
    const proj = out.x * uLocX + out.y * uLocY;
    const tickExtent =
      Math.max(c.half * proj, (c.half + c.dash.length) * proj) + (c.dash.width / 2) * alongAxis;
    return Math.max(extent, tickExtent);
  };

  // Pin point: marker edge + LABEL_GAP along the approach, stop-relative on
  // BOTH axes (the cell picks the octant; offset/offsetPerp fine-tune).
  const extent = extentAlong(ref, u);
  let pinRead = ref.proj * STOP_SIZE + u.x * (extent + LABEL_GAP);
  const pinPerp = ref.perp * STOP_SIZE + u.y * (extent + LABEL_GAP);

  // Cross stations (the Vignelli staple): the label parks squarely across
  // the line from its own stop — octants 2/6, which CENTER the text on that
  // stop — while a crossing line's stop is packed beside it in the same cell
  // row, and its stripe runs straight through the centered text. Re-anchor
  // the READING axis against that crossing stop so the text butts up to the
  // stripe instead of straddling it. Each axis stays measured against the
  // stop that actually blocks it: the perpendicular pin above still comes
  // from the label's own stop, so the baseline keeps its LABEL_GAP off the
  // line it labels (a row of labels along that line stays level) and doesn't
  // drift when the CROSSING line's width or interline gap changes.
  let textAnchorDefault = AUTO_TEXT_ANCHOR[o];
  const cross = o === 2 || o === 6 ? crossingStop(ref, gated) : null;
  if (cross) {
    const side = cross.proj > ref.proj ? 1 : -1; // which way along reading the stripe sits
    const away = { x: -side, y: 0 }; // crossing stop → label, along the reading axis
    pinRead = cross.proj * STOP_SIZE - side * (extentAlong(cross, away) + LABEL_GAP);
    textAnchorDefault = side > 0 ? 'end' : 'start';
  }

  // Fold the typographic target into the anchor. The anchor is the pinned
  // line's central-baseline center: the baseline sits `cb` below it, the
  // cap line CAP_FRACTION·fontSize above the baseline, and the Core Type
  // Area center halfway up the cap height.
  let anchorPerp: number;
  let valign: AutoAlignInfo['valign'];
  if (o === 5 || o === 6 || o === 7) {
    // Above: the LAST (bottom) line's baseline sits LABEL_GAP + one descender
    // above the marker; earlier lines stack upward, away from it.
    //
    // The Core Type Area stops at the baseline, but ink does not — so pinning
    // the baseline itself put a "g" inside the route line, by an amount that
    // grew with font size while LABEL_GAP stayed constant (touching at ~15,
    // overlapping above it). The allowance is unconditional, NOT measured per
    // name: giving it only to names that own a descender is the same rule the
    // tutorial rejects, since it would leave a row of labels on ragged
    // baselines. Every above-side label clears by the same amount and they all
    // stay level. Nothing below or beside moves — there the text grows AWAY
    // from the marker.
    anchorPerp = pinPerp - cb - DESCENDER_FRACTION * fontSize;
    valign = 'auto-up';
  } else if (o === 1 || o === 2 || o === 3) {
    // Below: the FIRST (top) line's cap hangs from the pin; later lines
    // stack downward, away from the marker.
    anchorPerp = pinPerp + (CAP_FRACTION * fontSize - cb);
    valign = 'auto-down';
  } else {
    // Beside: the FIRST line's Core Type Area centers on the stop's row and
    // extra lines grow down, keeping the first line level with the dot. The
    // half-cap step is `capCenterDy` — literally the rule every badge glyph
    // centers by — so an inline route bullet in a beside-aligned name lands on
    // the stop's row by construction rather than by two constants agreeing.
    anchorPerp = pinPerp + (capCenterDy(fontSize) - cb);
    valign = 'auto-down';
  }
  return applyAutoOverrides(label, textAnchorDefault, valign, pinRead, anchorPerp, lineAdvances);
}

/**
 * Decompose a SCREEN-frame pixel delta into the label's offset axes: the
 * `offset` component runs along the reading direction `(readCos, readSin)`,
 * the `offsetPerp` component along `(-readSin, readCos)` — the exact axes
 * labelLayoutLocal applies above, so writing `offset + dOffset` /
 * `offsetPerp + dPerp` moves the painted text by precisely `delta` on
 * screen. The basis is orthonormal (rotations preserve it), so the
 * decomposition is exact for all 8×8 station/label rotation combinations.
 */
export function screenDeltaToLabelOffsets(
  delta: Vec2,
  stationRotation: Rotation,
  labelRotation: Rotation,
): { dOffset: number; dPerp: number } {
  const local = worldDirToLocal(delta, stationRotation);
  const a = (labelRotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    dOffset: local.x * c + local.y * s,
    dPerp: local.x * -s + local.y * c,
  };
}
