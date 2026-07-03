import type { ReactNode } from 'react';
import { Line } from '../model/types';
import { hasInlineToken } from '../geometry/labelTokens';
import { BASELINE_FRACTION, LINE_HEIGHT, measureTextLabel } from '../geometry/textMeasure';
import { InlineBullet } from './InlineBullet';

export interface RenderLabelTextArgs {
  text: string;
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  paintOrder?: string;
  // Always written to the rendered <text> as an explicit value (never
  // omitted). Chromium leaves stale underline pixels behind when the
  // `text-decoration` SVG attribute toggles from "underline" back to absent
  // on a rotated <text>; rendering 'none' forces a proper paint
  // invalidation as hover clears.
  textDecoration: 'underline' | 'none';
  anchorX: number;
  anchorY: number;
  textAnchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'text-before-edge' | 'text-after-edge';
  firstLineDyPx: number;
  // Visual center y of the first text line in the rotated label frame.
  // The bullet path anchors each line with dominantBaseline='central' at
  // firstLineCenterY + i*lineSpacing so it lines up exactly with the
  // non-bullet path (also central-anchored). Without this, labels with
  // inline bullets render their first line a few pixels above their
  // bullet-free counterparts (SVG's 'hanging' anchor sits at the cap-line,
  // not the EM-box top).
  firstLineCenterY: number;
  rotationDeg: number;
  lineByService: Map<string, Line>;
}

/**
 * Render a station label's text content. For plain text (no bullet
 * tokens) this falls back to the historical single-`<text>` + `<tspan>`
 * pattern with its existing dominantBaseline/firstLineDy positioning, so
 * the wash silhouette / hit rect / unit tests stay byte-for-byte the same.
 * Labels that contain inline bullets switch to per-segment positioning:
 * each line is laid out explicitly via the segment-aware measurement, and
 * bullets render as a small badge shape with their service code (gray "?"
 * when the code doesn't resolve). Bullets always render in their own line
 * color and skip the contrast stroke — they're self-legible.
 */
export function renderStationLabelText({
  text,
  fontSize,
  fontWeight,
  fontStyle,
  fill,
  stroke,
  strokeWidth,
  paintOrder,
  textDecoration,
  anchorX,
  anchorY,
  textAnchor,
  baseline,
  firstLineDyPx,
  firstLineCenterY,
  rotationDeg,
  lineByService,
}: RenderLabelTextArgs): ReactNode {
  const hasBullet = hasInlineToken(text);
  const lines = text.split('\n');
  // Underline as explicit <line> geometry instead of the SVG `text-decoration`
  // attribute. Chromium leaves one-pixel residue on rotated <text> when
  // text-decoration toggles, and remounting via `key` breaks the cap-line
  // paint on the fresh element. Real <line> elements invalidate correctly
  // on mount AND unmount, so this sidesteps both bugs at once.
  const showUnderline = textDecoration === 'underline';
  // Measure ink widths so the explicit underline matches the visible text
  // extent (the same width SVG's text-decoration would have drawn). The
  // measurement is cached, so calling it here for the plain path is cheap.
  const measured = showUnderline
    ? measureTextLabel({
        text,
        fontSize,
        weight: fontWeight,
        italic: fontStyle === 'italic',
        bulletsOnly: true,
      })
    : null;
  // Distance from the central-baseline anchor down to the text baseline.
  // Reuses the constant the bullet path already relies on.
  const centralToBaseline = fontSize * (BASELINE_FRACTION - 0.5);
  // Underline geometry, in unrotated label-local px.
  const UNDERLINE_OFFSET = 4;
  const UNDERLINE_STROKE = 2;
  // Compute the y position of the FIRST line's baseline given the active
  // dominant-baseline mode. Subsequent lines stack 1.2em below.
  const firstLineBaselineY =
    baseline === 'central'
      ? anchorY + centralToBaseline + firstLineDyPx
      : baseline === 'text-before-edge'
        ? anchorY + fontSize * BASELINE_FRACTION + firstLineDyPx
        : anchorY - fontSize * (1 - BASELINE_FRACTION) + firstLineDyPx;
  const lineSpacingPx = fontSize * LINE_HEIGHT;
  if (!hasBullet) {
    return (
      <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
        <text
          x={anchorX}
          y={anchorY}
          textAnchor={textAnchor}
          dominantBaseline={baseline}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fontStyle={fontStyle}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          paintOrder={paintOrder}
          style={{ whiteSpace: 'pre' }}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={anchorX} dy={i === 0 ? firstLineDyPx : lineSpacingPx}>
              {line}
            </tspan>
          ))}
        </text>
        {showUnderline &&
          measured &&
          measured.lines.map((lm, i) => {
            if (lm.inkWidth <= 0) return null;
            const x1 = lineStartX(textAnchor, anchorX, lm.bearingLeft, lm.bearingRight);
            const x2 = x1 + lm.inkWidth;
            const y = firstLineBaselineY + i * lineSpacingPx + UNDERLINE_OFFSET;
            return (
              <line
                key={i}
                x1={x1}
                x2={x2}
                y1={y}
                y2={y}
                stroke={fill}
                strokeWidth={UNDERLINE_STROKE}
              />
            );
          })}
      </g>
    );
  }

  // Bullet path: measure segment-aware and emit explicit per-segment
  // elements. Each line is anchored at its visual center with
  // dominantBaseline='central' so it lines up with the non-bullet path
  // (also central-anchored). firstLineCenterY comes from the layout and
  // already encodes the valign semantics; line i sits lineSpacing below
  // the previous one.
  const m =
    measured ??
    measureTextLabel({
      text,
      fontSize,
      weight: fontWeight,
      italic: fontStyle === 'italic',
      bulletsOnly: true,
    });
  const lineSpacing = fontSize * LINE_HEIGHT;

  return (
    <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        const yCenter = firstLineCenterY + i * lineSpacing;
        const baselineY = yCenter + centralToBaseline;
        const lineLeftX = lineStartX(textAnchor, anchorX, lm.bearingLeft, lm.bearingRight);
        let cursor = lineLeftX;
        const nodes: ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
          cursor += seg.advance;
          if (seg.kind === 'text') {
            nodes.push(
              <text
                key={`${i}-${j}-t`}
                x={segCursor}
                y={yCenter}
                textAnchor="start"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={fontWeight}
                fontStyle={fontStyle}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                paintOrder={paintOrder}
                style={{ whiteSpace: 'pre' }}
              >
                {seg.value}
              </text>,
            );
          } else {
            const r = seg.diameter / 2;
            nodes.push(
              <InlineBullet
                key={`${i}-${j}-b`}
                code={seg.code}
                shape={seg.shape}
                filled={seg.filled}
                diameter={seg.diameter}
                cx={segCursor + r}
                // Bullet center at the text's optical midpoint (≈0.3em above
                // baseline) so the badge looks visually centered on mixed
                // upper/lowercase. Older convention sat the bullet's bottom on
                // the baseline, which left it riding above the cap-line.
                cy={baselineY - fontSize * 0.3}
                lineByService={lineByService}
              />,
            );
          }
        });
        // Explicit underline for this line (only when hover requests it).
        // Spans the full line including any inline bullets so the visual
        // result matches the plain-text path.
        if (showUnderline && lm.inkWidth > 0) {
          nodes.push(
            <line
              key={`${i}-u`}
              x1={lineLeftX}
              x2={lineLeftX + lm.inkWidth}
              y1={baselineY + UNDERLINE_OFFSET}
              y2={baselineY + UNDERLINE_OFFSET}
              stroke={fill}
              strokeWidth={UNDERLINE_STROKE}
            />,
          );
        }
        return <g key={i}>{nodes}</g>;
      })}
    </g>
  );
}

// Where the line's leftmost ink lives, in unrotated label-local coords. The
// underline geometry pivots off this same point so the painted underline
// hugs the visible text on both ends regardless of text-anchor.
function lineStartX(
  textAnchor: 'start' | 'middle' | 'end',
  anchorX: number,
  bearingLeft: number,
  bearingRight: number,
): number {
  if (textAnchor === 'start') return anchorX + bearingLeft;
  if (textAnchor === 'end') return anchorX - bearingRight;
  return anchorX + (bearingLeft - bearingRight) / 2;
}
