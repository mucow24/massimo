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
  // Tight box around the rendered text in unrotated station-local coords,
  // padded by HIT_PAD on each side. Used by:
  //  - the bg hit-test rect (rotated about (anchorX, anchorY) for hit-testing)
  //  - the wash/stroke silhouette polygon (rotated for the union path)
  hitX: number;
  hitY: number;
  hitW: number;
  hitH: number;
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

  const isAdjacent = (row: number, col: number) => {
    if (stops.some((s) => s.row === row && s.col === col)) return true;
    if (phantomDot && phantomDot.row === row && phantomDot.col === col) return true;
    return false;
  };

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
    // 'auto' (or unset): snap against an adjacent stop; otherwise center.
    const adjPlus = isAdjacent(label.row + dirPlus.dRow, label.col + dirPlus.dCol);
    const adjMinus = isAdjacent(label.row + dirMinus.dRow, label.col + dirMinus.dCol);
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

  // Top of the painted text block, given the dominant baseline:
  // - 'text-before-edge': first line's top is AT the anchor.
  // - 'central'         : first line's center is AT the anchor (block top is
  //                       half a line above).
  // - 'text-after-edge' : first line's bottom is AT the anchor (block top is
  //                       a full line above).
  let textYMin: number;
  if (baseline === 'text-before-edge') textYMin = anchorY;
  else if (baseline === 'text-after-edge') textYMin = anchorY - 2 * TEXT_HALF_H;
  else textYMin = anchorY - TEXT_HALF_H;

  const blockH = 2 * TEXT_HALF_H + extraLines * LABEL_LINE_HEIGHT;

  return {
    anchorX,
    anchorY,
    textAnchor,
    baseline,
    hitX: textXMin - HIT_PAD,
    hitY: textYMin - HIT_PAD,
    hitW: textW + 2 * HIT_PAD,
    hitH: blockH + 2 * HIT_PAD,
  };
}
