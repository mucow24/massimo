import type { Station } from '../model/types';
import { DIR_8, STOP_SIZE, stopCenterAt, worldDirToLocal, type Rotation } from './orientation';
import type { Vec2 } from './vec';
import { LINE_HEIGHT, measureTextLabel } from './textMeasure';

const HIT_PAD = 2;
const LABEL_GAP = 3;
const HALF = STOP_SIZE / 2;

/**
 * Per-stop half-extent lookup (world units), keyed by line id — how far a
 * stop's marker square extends from its center. Production callers pass
 * `stopHalfOf(lines)` (model/lineWidth.ts); the default reproduces the
 * uniform STOP_SIZE/2 every stop had before per-line widths. Shared with
 * stationBoundary so the renderer and the hit geometry read widths through
 * the same shape.
 */
export type StopHalfFn = (lineId: string) => number;
export const DEFAULT_STOP_HALF: StopHalfFn = () => HALF;

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
  // SVG attribute values: which side of the anchor the text aligns to.
  textAnchor: 'start' | 'middle' | 'end';
  baseline: LabelBaseline;
  // First-line baseline shift in px (negative = up), shifting a multi-line
  // block so `valign` refers to the BLOCK, not just the first line. Subsequent
  // lines stack one line-height below. 0 = no shift.
  firstLineDyPx: number;
  // Tight box around the rendered text in unrotated station-local coords,
  // padded by HIT_PAD on each side. Used by:
  //  - the bg hit-test rect (rotated about (anchorX, anchorY) for hit-testing)
  //  - the wash/stroke silhouette polygon (rotated for the union path)
  hitX: number;
  hitY: number;
  hitW: number;
  hitH: number;
  // Top of the painted text block (no HIT_PAD). The bullet-rendering path
  // in StationView reads this directly so it doesn't have to re-derive the
  // valign math — important for 'auto-down'/'auto-up', where baseline='central'
  // alone doesn't disambiguate from 'middle'.
  blockTopY: number;
  // Visual center y of the first text line. The bullet-rendering path
  // anchors each line with dominantBaseline='central' at
  // firstLineCenterY + i*lineSpacing, matching the non-bullet path's
  // central-baseline rendering exactly. If the bullet path positioned by
  // text TOP instead (blockTopY + dominantBaseline='hanging'), labels
  // containing bullets would render a few pixels higher than their
  // bullet-free counterparts because SVG's 'hanging' anchor sits at the
  // cap-line, not the EM-box top.
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
  // Per-stop half-extent lookup. Renderer (StationLabel) and hit geometry
  // (stationBoundary) MUST pass the same lookup or the wash/hit rect drifts
  // off the painted text next to a non-default-width stop.
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
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

  let textAnchor: 'start' | 'middle' | 'end' = 'middle';
  let anchorX = labelCenter.x;
  let anchorY = labelCenter.y;

  if (label.align === 'start' || label.align === 'middle' || label.align === 'end') {
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
    const plus = snapInfoInHalfPlane(stops, phantomDot, label, readCos, readSin, 1, stopHalf);
    const minus = snapInfoInHalfPlane(stops, phantomDot, label, readCos, readSin, -1, stopHalf);
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
  if (label.valign === 'top') baseline = 'text-before-edge';
  else if (label.valign === 'bottom') baseline = 'text-after-edge';

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
  const nameLines = station.name.split('\n');
  const extraLines = nameLines.length - 1;
  // Measure the widest line's true ink width at the rendered font metrics.
  // This is bullet-aware (a `<CODE>` token measures as one small circle, not
  // as its literal characters) and font-size-aware, so the hit rect / wash
  // silhouette hugs the painted glyphs instead of a per-character guess that
  // ballooned for small fonts and labels containing inline route bullets.
  const measured = measure({
    text: station.name,
    fontSize: style.fontSize,
    weight: style.weight,
    // Per-station italic ORs with the doc-wide default, matching the renderer.
    italic: style.italic || !!station.labelItalic,
    literalBullets: style.literalBullets,
    // Station names parse bullets only — formatting tags are a text-label
    // feature and must stay literal here (matches renderStationLabelText).
    bulletsOnly: true,
    // Global leading/tracking: tracking widens the measured ink; leading feeds
    // the height math below (measureTextLabel returns a leaded height too, but
    // the vertical metrics here are derived independently).
    leading: style.leading,
    tracking: style.tracking,
  });
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
  // by shifting only the first line up; subsequent tspans stack 1.2em below
  // it as before. The anchor itself stays on the L cell so rotation still
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
  if (label.valign === 'middle') firstLineShiftPx = (extraLines * lineStackPx) / 2;
  else if (label.valign === 'bottom' || label.valign === 'auto-up')
    firstLineShiftPx = extraLines * lineStackPx;
  // First-line baseline shift in px (negative = up). The renderer applies the
  // per-line stacking in px too, so no em round-trip is needed.
  const firstLineDyPx = firstLineShiftPx === 0 ? 0 : -firstLineShiftPx;

  // Top of the painted text block (already accounting for the first-line
  // shift above):
  //   - top      : block top at anchorY
  //   - auto-down: first line top at anchorY - TEXT_HALF_H, block grows down
  //                (block top stays put as lines are added)
  //   - middle   : half a block-height above anchorY
  //   - bottom   : a full block-height above anchorY
  //   - auto-up  : last line bottom at anchorY + TEXT_HALF_H, block grows up
  //                (block bottom stays put as lines are added) — i.e. block
  //                top at anchorY - TEXT_HALF_H - extraLines*LINE_HEIGHT
  const blockH = 2 * textHalfH + extraLines * lineStackPx;
  let textYMin: number;
  if (label.valign === 'top') textYMin = anchorY;
  else if (label.valign === 'bottom') textYMin = anchorY - blockH;
  else if (label.valign === 'auto-down') textYMin = anchorY - textHalfH;
  else if (label.valign === 'auto-up') textYMin = anchorY - textHalfH - extraLines * lineStackPx;
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
  stops: Station['stops'],
  phantomDot: { row: number; col: number } | null,
  label: Station['label'],
  readCos: number,
  readSin: number,
  sign: 1 | -1,
  stopHalf: StopHalfFn,
): SnapInfo {
  // Perpendicular gate in cell-space: HALF / STOP_SIZE = 0.5. A stop with
  // |perp| > this sits outside the text's perpendicular envelope, so the
  // text naturally clears it and no anchor clamp is needed. Intentionally
  // NOT width-scaled: it gates on the TEXT's perpendicular extent (a font
  // metric in label-cell units), not on the stop's body.
  const PERP_GATE = 0.5;
  let inHalfPlane = false;
  let inWayStopProj: number | null = null;
  let inWayStopHalf: number | null = null;
  const consider = (dRow: number, dCol: number, half: number) => {
    // Accept any cell whose Chebyshev distance is at most the TANGENCY
    // distance between the unit label cell and this stop — (half + HALF) in
    // world units, divided back into cell units. For a default-width stop
    // that's the historical 1-cell gate; a width-28 stop tangent to the
    // label sits 1.5 cells away and must still snap. The dual grid editor
    // (#36) places diagonal-grid neighbors at ±√2/2 per axis so they're
    // tangent on screen; a small epsilon keeps exact-tangent neighbors in.
    const adjMax = (half + HALF) / STOP_SIZE + 1e-4;
    if (Math.max(Math.abs(dRow), Math.abs(dCol)) > adjMax) return;
    const proj = dCol * readCos + dRow * readSin;
    if (sign * proj <= 1e-6) return;
    inHalfPlane = true;
    // Perpendicular (CCW 90° from reading): (-readSin, readCos).
    const perp = dCol * -readSin + dRow * readCos;
    if (Math.abs(perp) > PERP_GATE) return;
    // For adjMinus (sign=-1): proj is negative; track the LARGEST (closest
    // to 0) — that's the stop nearest along reading, the one the anchor
    // most needs to clear. For adjPlus, track the smallest (also closest
    // to 0). In both cases: -sign * proj is positive and we minimize it.
    if (inWayStopProj === null || -sign * proj < -sign * inWayStopProj) {
      inWayStopProj = proj;
      inWayStopHalf = half;
    }
  };
  for (const s of stops) consider(s.row - label.row, s.col - label.col, stopHalf(s.lineId));
  if (phantomDot) consider(phantomDot.row - label.row, phantomDot.col - label.col, HALF);
  return { inHalfPlane, inWayStopProj, inWayStopHalf };
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
