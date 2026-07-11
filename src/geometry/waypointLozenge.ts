import { measureAdvance } from './textMeasure';

// Pill proportions — the single source of truth shared by the drawn lozenge
// (WaypointLozenge.tsx) and the hit/selection geometry, so the clickable box and
// selection ring exactly match the painted pill. Text size is a fraction of the
// host label font; padding is a fraction of that pill text.
const PILL_FONT_RATIO = 0.72;
const PILL_PAD_X_RATIO = 0.5;
const PILL_PAD_Y_RATIO = 0.28;

/**
 * The "WP" pill's box for a given host font size: outer width/height plus the
 * pill's own text size. Width tracks the measured "WP" advance so the pill hugs
 * its text on both edges.
 */
export function waypointLozengeSize(fontSize: number): { w: number; h: number; pillFont: number } {
  const pillFont = fontSize * PILL_FONT_RATIO;
  const padX = pillFont * PILL_PAD_X_RATIO;
  const padY = pillFont * PILL_PAD_Y_RATIO;
  const textW = measureAdvance('WP', pillFont, 600, false);
  return { w: textW + 2 * padX, h: pillFont + 2 * padY, pillFont };
}

/**
 * The WP lozenge's axis-aligned rect in station-local (pre-label-rotation)
 * coords, standing in for the station name. It lands where the name would: its
 * start/middle/end edge sits on the label anchor per `textAnchor`, and it's
 * vertically centered on the label block. Callers rotate the rect about
 * (anchorX, anchorY) by the label rotation, exactly like the text rect it
 * replaces — so the paint, the hit rect, and the selection ring all agree.
 */
export function waypointLabelRectLocal(
  lay: { textAnchor: 'start' | 'middle' | 'end'; anchorX: number; hitY: number; hitH: number },
  fontSize: number,
): { x: number; y: number; w: number; h: number } {
  const { w, h } = waypointLozengeSize(fontSize);
  const x =
    lay.textAnchor === 'start'
      ? lay.anchorX
      : lay.textAnchor === 'end'
        ? lay.anchorX - w
        : lay.anchorX - w / 2;
  const y = lay.hitY + lay.hitH / 2 - h / 2;
  return { x, y, w, h };
}
