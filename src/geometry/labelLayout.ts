import type { Station } from '../model/types';
import { DIR_8, stopCenterAt } from './orientation';

const HIT_PAD = 2;
const LABEL_GAP = 5;
const TEXT_HALF_H = 7;
const LABEL_LINE_HEIGHT = 14;

export type LabelBaseline = 'central' | 'text-before-edge' | 'text-after-edge';

export interface LabelLayout {
  // Anchor point of the rendered <text> element in unrotated station-local
  // coords. The label's `rotation` is applied around this point at render
  // time.
  anchorX: number;
  anchorY: number;
  // SVG attribute values: which side of the anchor the text aligns to.
  textAnchor: 'start' | 'middle' | 'end';
  baseline: LabelBaseline;
  // dy for the FIRST tspan, used to shift multi-line blocks so that valign
  // refers to the BLOCK rather than just the first line. Subsequent tspans
  // stack 1.2em below this one. Empty string means "no dy attribute".
  firstLineDy: string;
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
  // valign math — important for 'auto', where baseline='central' alone
  // doesn't disambiguate from 'middle'.
  blockTopY: number;
}

/**
 * Single source of truth for label placement. Mirrors what `StationView`
 * paints; consumed by both the renderer and the selection/hit geometry so
 * the wash silhouette and the hit rect always agree with the visible text.
 */
export function labelLayoutLocal(station: Station): LabelLayout {
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
    const adjPlus = anyStopInHalfPlane(stops, phantomDot, label, readCos, readSin, 1);
    const adjMinus = anyStopInHalfPlane(stops, phantomDot, label, readCos, readSin, -1);
    if (adjPlus) {
      textAnchor = 'end';
      anchorX = labelCenter.x + dirPlus.anchor.x - LABEL_GAP * readCos;
      anchorY = labelCenter.y + dirPlus.anchor.y - LABEL_GAP * readSin;
    } else if (adjMinus) {
      textAnchor = 'start';
      anchorX = labelCenter.x + dirMinus.anchor.x + LABEL_GAP * readCos;
      anchorY = labelCenter.y + dirMinus.anchor.y + LABEL_GAP * readSin;
    }
  }

  // 'auto' and 'middle' both use central baseline; they differ in how
  // multi-line blocks are shifted relative to the anchor (see firstLineDy /
  // blockTopY below).
  let baseline: LabelBaseline = 'central';
  if (label.valign === 'top') baseline = 'text-before-edge';
  else if (label.valign === 'bottom') baseline = 'text-after-edge';

  if (label.offset) {
    anchorX += label.offset * readCos;
    anchorY += label.offset * readSin;
  }

  // Hit rect in unrotated local coords, *before* the label.rotation rotation
  // is applied to it.
  const nameLines = station.name.split('\n');
  const longestLineLen = nameLines.reduce((m, l) => Math.max(m, l.length), 0);
  const textW = Math.max(20, longestLineLen * 7);
  const extraLines = nameLines.length - 1;

  let textXMin: number;
  if (textAnchor === 'start') textXMin = anchorX;
  else if (textAnchor === 'end') textXMin = anchorX - textW;
  else textXMin = anchorX - textW / 2;

  // Vertical alignment, in BLOCK terms for top/middle/bottom and in
  // FIRST-LINE terms for auto: 'top' puts the block top at the anchor,
  // 'middle' centers the block, 'bottom' puts the block bottom at the
  // anchor, 'auto' keeps the first line's center on the anchor with the
  // rest of the block extending below it. We achieve this by shifting only
  // the first line up; subsequent tspans stack 1.2em below it as before.
  // The anchor itself stays on the L cell so rotation still pivots there.
  //
  // Lines stack down by `LABEL_LINE_HEIGHT` (~1.2em). The block's height is
  // `2*textHalfH + extraLines*LINE_HEIGHT`. The first line's natural y given
  // the dominant baseline is:
  //   - 'text-before-edge': first line top   = anchorY
  //   - 'central'         : first line center= anchorY  (top = anchorY - 7)
  //   - 'text-after-edge' : first line bottom= anchorY  (top = anchorY - 14)
  // To put the BLOCK at the desired position relative to anchorY, shift the
  // first line up by:
  //   - top   : 0
  //   - auto  : 0  (first line center already at anchorY via central baseline)
  //   - middle: extraLines * LINE_HEIGHT / 2
  //   - bottom: extraLines * LINE_HEIGHT
  let firstLineShiftPx = 0;
  if (label.valign === 'middle') firstLineShiftPx = (extraLines * LABEL_LINE_HEIGHT) / 2;
  else if (label.valign === 'bottom') firstLineShiftPx = extraLines * LABEL_LINE_HEIGHT;
  // Keep dy in em (matches the '1.2em' stacking on subsequent tspans), so it
  // tracks font-size if we ever change it.
  const FONT_SIZE_PX = 12;
  const firstLineDy =
    firstLineShiftPx === 0 ? '0' : `${(-firstLineShiftPx / FONT_SIZE_PX).toFixed(3)}em`;

  // Top of the painted text block (already accounting for the first-line
  // shift above):
  //   - top   : block top at anchorY
  //   - auto  : first line top at anchorY - TEXT_HALF_H, block grows down
  //   - middle: half a block-height above anchorY
  //   - bottom: a full block-height above anchorY
  const blockH = 2 * TEXT_HALF_H + extraLines * LABEL_LINE_HEIGHT;
  let textYMin: number;
  if (label.valign === 'top') textYMin = anchorY;
  else if (label.valign === 'bottom') textYMin = anchorY - blockH;
  else if (label.valign === 'auto') textYMin = anchorY - TEXT_HALF_H;
  else textYMin = anchorY - blockH / 2;

  return {
    anchorX,
    anchorY,
    textAnchor,
    baseline,
    firstLineDy,
    hitX: textXMin - HIT_PAD,
    hitY: textYMin - HIT_PAD,
    hitW: textW + 2 * HIT_PAD,
    hitH: blockH + 2 * HIT_PAD,
    blockTopY: textYMin,
  };
}

/**
 * Is any stop (or the phantom dot) one cell away from the label, in the
 * half-plane on `sign`'s side of the reading direction? `sign` is +1 for
 * the "ahead" half-plane (dirPlus) or -1 for "behind" (dirMinus).
 */
function anyStopInHalfPlane(
  stops: Station['stops'],
  phantomDot: { row: number; col: number } | null,
  label: Station['label'],
  readCos: number,
  readSin: number,
  sign: 1 | -1,
): boolean {
  // Threshold > 0 — perpendicular cells (dot ≈ 0) don't snap; cells in the
  // half-plane have |dot| ≥ ~0.707 so a tiny floating-point epsilon would
  // also work, but a strict > 0 (with sign applied) is fine for our 8-way
  // grid.
  const isInHalfPlane = (dRow: number, dCol: number) => {
    const dx = dCol;
    const dy = dRow;
    const dot = dx * readCos + dy * readSin;
    return sign * dot > 1e-6;
  };
  for (const s of stops) {
    const dRow = s.row - label.row;
    const dCol = s.col - label.col;
    // Only one-cell-away neighbors (Chebyshev distance == 1).
    if (Math.max(Math.abs(dRow), Math.abs(dCol)) !== 1) continue;
    if (isInHalfPlane(dRow, dCol)) return true;
  }
  if (phantomDot) {
    const dRow = phantomDot.row - label.row;
    const dCol = phantomDot.col - label.col;
    if (Math.max(Math.abs(dRow), Math.abs(dCol)) === 1 && isInHalfPlane(dRow, dCol)) return true;
  }
  return false;
}
