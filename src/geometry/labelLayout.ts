import type { MapDoc, Station, StopOrientation } from '../model/types';
import {
  DIR_8,
  STOP_SIZE,
  stopCenterAt,
  travelDirLocal,
  worldDirToLocal,
  type Rotation,
} from './orientation';
import { DIRS_8, dirIndex } from './router';
import type { Vec2 } from './vec';
import { BASELINE_FRACTION, CAP_FRACTION, LINE_HEIGHT, measureTextLabel } from './textMeasure';

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

/** The doc-level station-label fields `docLabelStyle` reads. */
export type DocLabelFields = Pick<
  MapDoc,
  'labelFontSize' | 'labelWeight' | 'labelItalic' | 'labelLeading' | 'labelTracking'
>;

/**
 * The doc's global station-label defaults as a `LabelStyle` — the one mapping
 * from the model's `label*` field names to the geometry style shape. Station
 * consumers fold the per-station bold in afterwards via
 * `effectiveStationLabelStyle`.
 */
export function docLabelStyle(doc: DocLabelFields): LabelStyle {
  return {
    fontSize: doc.labelFontSize,
    weight: doc.labelWeight,
    italic: doc.labelItalic,
    leading: doc.labelLeading,
    tracking: doc.labelTracking,
  };
}

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
    // Per-station italic ORs with the doc-wide default, matching the renderer.
    italic: style.italic || !!station.labelItalic,
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
      (_, i) => measured.lines[i]?.advanceWidth ?? measured.lineWidths[i] ?? measured.width,
    );
    const info = autoAlignInfo(
      stops,
      phantomDot,
      label,
      readCos,
      readSin,
      style.fontSize,
      stopHalf,
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
  for (const s of stops) consider(s.row - label.row, s.col - label.col, stopHalf(s.lineId));
  if (phantomDot) consider(phantomDot.row - label.row, phantomDot.col - label.col, HALF);
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
 */
function autoAlignInfo(
  stops: Station['stops'],
  phantomDot: { row: number; col: number } | null,
  label: Station['label'],
  readCos: number,
  readSin: number,
  fontSize: number,
  stopHalf: StopHalfFn,
  // Per-line pen advances of the rendered name, for the H/V overrides.
  lineAdvances: number[],
): AutoAlignInfo {
  interface Candidate {
    dRow: number;
    dCol: number;
    half: number;
    orientation: StopOrientation | null;
  }
  const candidates: Candidate[] = stops.map((s) => ({
    dRow: s.row - label.row,
    dCol: s.col - label.col,
    half: stopHalf(s.lineId),
    orientation: s.orientation,
  }));
  if (phantomDot) {
    candidates.push({
      dRow: phantomDot.row - label.row,
      dCol: phantomDot.col - label.col,
      half: HALF,
      orientation: null,
    });
  }

  // Reference stop: the nearest candidate within the tangency gate. Ties
  // prefer the stop below the text (larger perp), so the label sits on its
  // baseline above the line — the typographic default side.
  let ref: {
    proj: number;
    perp: number;
    half: number;
    orientation: StopOrientation | null;
  } | null = null;
  let refD2 = Infinity;
  for (const c of candidates) {
    const cheb = Math.max(Math.abs(c.dRow), Math.abs(c.dCol));
    if (cheb < 1e-6) continue; // a stop on the label cell has no direction
    if (cheb > (c.half + HALF) / STOP_SIZE + 1e-4) continue; // same gate as the legacy snap
    const proj = c.dCol * readCos + c.dRow * readSin;
    const perp = c.dCol * -readSin + c.dRow * readCos;
    const d2 = c.dRow * c.dRow + c.dCol * c.dCol;
    if (ref === null || d2 < refD2 - 1e-9 || (d2 < refD2 + 1e-9 && perp > ref.perp)) {
      ref = { proj, perp, half: c.half, orientation: c.orientation };
      refD2 = Math.min(refD2, d2);
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
      (CAP_FRACTION / 2) * fontSize - cb,
      lineAdvances,
    );
  }

  const o = dirIndex({ x: -ref.proj, y: -ref.perp });
  const u = DIRS_8[o]; // approach unit vector, stop → label, reading frame

  // Marker extent along the approach, via the rotated square's support
  // function in the LOCAL frame. The phantom dot has no orientation; treat
  // it as axis-aligned (extent = half for its cardinal approach).
  const uLocX = u.x * readCos - u.y * readSin;
  const uLocY = u.x * readSin + u.y * readCos;
  const axis = ref.orientation ? travelDirLocal(ref.orientation) : { x: 1, y: 0 };
  const extent =
    ref.half *
    (Math.abs(uLocX * axis.x + uLocY * axis.y) + Math.abs(uLocX * -axis.y + uLocY * axis.x));

  // Pin point: marker edge + LABEL_GAP along the approach, stop-relative on
  // BOTH axes (the cell picks the octant; offset/offsetPerp fine-tune).
  const pinRead = ref.proj * STOP_SIZE + u.x * (extent + LABEL_GAP);
  const pinPerp = ref.perp * STOP_SIZE + u.y * (extent + LABEL_GAP);

  // Fold the typographic target into the anchor. The anchor is the pinned
  // line's central-baseline center: the baseline sits `cb` below it, the
  // cap line CAP_FRACTION·fontSize above the baseline, and the Core Type
  // Area center halfway up the cap height.
  let anchorPerp: number;
  let valign: AutoAlignInfo['valign'];
  if (o === 5 || o === 6 || o === 7) {
    // Above: the LAST (bottom) line's baseline sits on the pin; earlier
    // lines stack upward, away from the marker.
    anchorPerp = pinPerp - cb;
    valign = 'auto-up';
  } else if (o === 1 || o === 2 || o === 3) {
    // Below: the FIRST (top) line's cap hangs from the pin; later lines
    // stack downward, away from the marker.
    anchorPerp = pinPerp + (CAP_FRACTION * fontSize - cb);
    valign = 'auto-down';
  } else {
    // Beside: the FIRST line's Core Type Area centers on the stop's row and
    // extra lines grow down, keeping the first line level with the dot.
    anchorPerp = pinPerp + ((CAP_FRACTION / 2) * fontSize - cb);
    valign = 'auto-down';
  }
  return applyAutoOverrides(label, AUTO_TEXT_ANCHOR[o], valign, pinRead, anchorPerp, lineAdvances);
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
