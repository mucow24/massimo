import type { ReactNode } from 'react';
import { Line } from '../model/types';
import { hasFormattedToken, resolveRunWeight, type SegmentStyle } from '../geometry/labelTokens';
import {
  BASELINE_FRACTION,
  LINE_HEIGHT,
  capCenterDy,
  measureTextLabel,
} from '../geometry/textMeasure';
import { InlineBullet } from './InlineBullet';

export interface RenderLabelTextArgs {
  text: string;
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  // Global station-label line-spacing multiplier (default 1) and letter-spacing
  // in em (default 0). Mirror the per-label leading/tracking on TextLabel.
  leading?: number;
  tracking?: number;
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
  // Visual center y of the first text line in the rotated label frame, already
  // encoding the valign AND the multi-line first-line shift. BOTH render paths
  // derive every baseline from it (see firstLineBaselineY), which is what keeps
  // a bulleted label on exactly the y its plain counterpart would use.
  // `LabelLayout`'s `baseline`/`firstLineDyPx` are deliberately NOT taken: they
  // describe the first line's top/bottom EDGE, a frame the 1.2em line box and
  // the 1.0em em box disagree on.
  firstLineCenterY: number;
  rotationDeg: number;
  lineByService: Map<string, Line>;
}

/**
 * Render a station label's text content. For plain text (no bullet
 * tokens) this falls back to the single-`<text>` + `<tspan>` pattern, placed on
 * the alphabetic baseline at the y the layout model predicts — so the painted
 * glyphs, the wash silhouette, the hit rect and the underline are all the same
 * number, on every platform.
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
  leading,
  tracking,
  fill,
  stroke,
  strokeWidth,
  paintOrder,
  textDecoration,
  anchorX,
  anchorY,
  textAnchor,
  firstLineCenterY,
  rotationDeg,
  lineByService,
}: RenderLabelTextArgs): ReactNode {
  const lead = leading ?? 1;
  // Letter-spacing in user units, added after every glyph (SVG letter-spacing,
  // matching how the measurement models it).
  const letterSpacingPx = (tracking ?? 0) * fontSize;
  // Inline tokens (bullets OR formatting tags) and tracking both route through
  // the per-segment path: it emits one <text> per styled run, so per-run
  // weight/italic/color/decorations paint correctly AND the PDF export's
  // letter-spacing bake (getComputedTextLength, per single-run <text>) stays
  // correct. The plain single-<text>+<tspan>s path is kept byte-for-byte for the
  // untagged, untracked common case (its multi-line getComputedTextLength would
  // sum every line).
  const perSegment = hasFormattedToken(text) || letterSpacingPx !== 0;
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
  // Full-grammar measurement: a "<b>Foo</b>" name parses into styled
  // runs, so its segments carry the <b>/<i>/<color> styles the
  // per-segment path paints. When the hover underline is showing this result is
  // reused as `m` below, so it MUST be measured the same way the per-segment
  // path is — otherwise a hovered tagged label would render un-styled.
  const measured = showUnderline
    ? measureTextLabel({
        text,
        fontSize,
        weight: fontWeight,
        italic: fontStyle === 'italic',
        leading: lead,
        tracking,
      })
    : null;
  // Distance from a line's CENTER down to its text baseline.
  const centralToBaseline = fontSize * (BASELINE_FRACTION - 0.5);
  // Underline geometry, in unrotated label-local px.
  const UNDERLINE_OFFSET = 4;
  const UNDERLINE_STROKE = 2;
  // The FIRST line's baseline, in label-local coords — the single number the
  // glyphs, the underline and the layout geometry all key off. Written straight
  // to the <text> rather than handed to `dominant-baseline`, whose real offset
  // Chrome derives from platform font metrics (0.333em at fontSize 12 on
  // Windows, 0.258em on macOS — never the 0.3em assumed here). Subsequent lines
  // stack by `lineSpacingPx` below (leading-scaled).
  //
  // Measured from the line's CENTER, never from its top or bottom edge, for
  // every valign. labelLayout works in a 1.2em LINE box (LINE_HEIGHT) while
  // BASELINE_FRACTION measures down from the 1.0em EM box top; the two share a
  // center but not their edges — 0.1em of half-leading sits at each end. So
  // center-relative is the only frame both agree on, and `firstLineCenterY`
  // already folds in the valign AND the multi-line first-line shift.
  const firstLineBaselineY = firstLineCenterY + centralToBaseline;
  const lineSpacingPx = fontSize * LINE_HEIGHT * lead;
  if (!perSegment) {
    return (
      <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
        <text
          x={anchorX}
          // ON the model's own baseline, alphabetic — not `anchorY` + a
          // dominant-baseline mode. See firstLineBaselineY.
          y={firstLineBaselineY}
          textAnchor={textAnchor}
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
            // firstLineDyPx is already folded into firstLineBaselineY, so line
            // 0 adds nothing and the rest stack by one line spacing.
            <tspan key={i} x={anchorX} dy={i === 0 ? 0 : lineSpacingPx}>
              {line}
            </tspan>
          ))}
        </text>
        {showUnderline &&
          measured &&
          measured.lines.map((lm, i) => {
            if (lm.inkWidth <= 0) return null;
            // Underline hugs the visible ink: start at the pen origin walked left
            // by the line's leading bearing (ink-left = penStart − bearingLeft).
            const x1 = lineStartPenX(textAnchor, anchorX, lm.alignAdvance) - lm.bearingLeft;
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

  // Per-segment path: measure segment-aware and emit explicit per-segment
  // elements. Taken for inline-bullet labels AND any tracked label. Each line
  // lands on the same alphabetic baseline the plain path would have used, so
  // the two agree glyph-for-glyph. firstLineCenterY comes from the layout and
  // already encodes the valign semantics; line i sits lineSpacing below the
  // previous one.
  const m =
    measured ??
    measureTextLabel({
      text,
      fontSize,
      weight: fontWeight,
      italic: fontStyle === 'italic',
      leading: lead,
      tracking,
    });
  // Same first-line baseline the plain path uses. Later lines stack by the
  // measurer's cumulative baseline deltas (which already grow with any inline
  // <size>), rather than a fixed per-line spacing, so a bigger run spreads the
  // lines apart.
  const baseline0FromTop = m.lines[0].baselineFromTop;

  // Per-run style resolution for the inline formatting tags, mirroring
  // LabelView: <w=…>/<b> resolve the weight against the label's base, <i> ORs
  // with the label's base italic, <size=…> resolves the run size against the
  // base, <color=…> overrides the fill for that run only.
  const runWeight = (style?: SegmentStyle) => resolveRunWeight(fontWeight, style);
  const runItalic = (style?: SegmentStyle) => fontStyle === 'italic' || !!style?.italic;
  const runFill = (style?: SegmentStyle) => style?.color ?? fill;

  return (
    <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        // Shared baseline for every run on this line; the measurer placed the
        // cumulative offset, so a bigger inline <size> already spread the lines.
        const baselineY = firstLineBaselineY + (lm.baselineFromTop - baseline0FromTop);
        const linePenX = lineStartPenX(textAnchor, anchorX, lm.alignAdvance);
        let cursor = linePenX;
        const nodes: ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
          cursor += seg.advance;
          if (seg.kind === 'text') {
            const st = seg.style;
            const segFontSize = seg.fontSize;
            nodes.push(
              <text
                key={`${i}-${j}-t`}
                x={segCursor}
                // Every run sits ON the shared alphabetic baseline, so mixed
                // sizes align with no per-size anchor back-off to get wrong.
                y={baselineY}
                textAnchor="start"
                fontSize={segFontSize}
                fontWeight={runWeight(st)}
                fontStyle={runItalic(st) ? 'italic' : undefined}
                letterSpacing={letterSpacingPx !== 0 ? letterSpacingPx : undefined}
                fill={runFill(st)}
                stroke={stroke}
                strokeWidth={strokeWidth}
                paintOrder={paintOrder}
                style={{ whiteSpace: 'pre' }}
              >
                {seg.value}
              </text>,
            );
            // <u>/<s> tag decorations for this run, as explicit <line> geometry
            // (same reason as the hover underline: svg2pdf ignores
            // text-decoration and Chromium leaks paint on rotated <text>). Tagged
            // with data-text-decoration so they read apart from the hover
            // underline. Offsets/thickness scale with the RUN's size and hang off
            // the shared baseline, matching LabelView for cross-label parity.
            if (st && (st.underline || st.strike) && seg.advance > 0) {
              const thickness = segFontSize * 0.07;
              if (st.underline) {
                nodes.push(
                  <line
                    key={`${i}-${j}-tu`}
                    data-text-decoration="underline"
                    x1={segCursor}
                    x2={segCursor + seg.advance}
                    y1={baselineY + segFontSize * 0.1}
                    y2={baselineY + segFontSize * 0.1}
                    stroke={runFill(st)}
                    strokeWidth={thickness}
                  />,
                );
              }
              if (st.strike) {
                nodes.push(
                  <line
                    key={`${i}-${j}-ts`}
                    data-text-decoration="strike"
                    x1={segCursor}
                    x2={segCursor + seg.advance}
                    y1={baselineY - segFontSize * 0.28}
                    y2={baselineY - segFontSize * 0.28}
                    stroke={runFill(st)}
                    strokeWidth={thickness}
                  />,
                );
              }
            }
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
                // Optically centered on the CAP BOX — the same rule capCenterDy
                // applies to the code inside the bullet, so badge and text agree
                // by construction. (Was a flat 0.3em, which rendered at ~0.333em
                // because the text used to paint off its own baseline.)
                cy={baselineY - capCenterDy(fontSize)}
                lineByService={lineByService}
              />,
            );
          }
        });
        // Explicit underline for this line (only when hover requests it).
        // Spans the full line including any inline bullets so the visual
        // result matches the plain-text path.
        if (showUnderline && lm.inkWidth > 0) {
          // Hug the ink: start at the pen origin walked left by the leading bearing.
          const inkX1 = linePenX - lm.bearingLeft;
          nodes.push(
            <line
              key={`${i}-u`}
              x1={inkX1}
              x2={inkX1 + lm.inkWidth}
              y1={baselineY + UNDERLINE_OFFSET}
              y2={baselineY + UNDERLINE_OFFSET}
              stroke={fill}
              strokeWidth={UNDERLINE_STROKE}
            />,
          );
        }
        return (
          <g key={i} data-label-line={i}>
            {nodes}
          </g>
        );
      })}
    </g>
  );
}

// Pen-origin start of the line, in unrotated label-local coords. Lines align by
// PEN advance (matching the plain single-<text>/<tspan> path's text-anchor
// behavior and LabelView), so they flush on the font's designed side bearings
// and read even — not by raw ink, which would pin each line's leftmost ink
// pixel to the anchor and shove hooked/round initials inward.
function lineStartPenX(
  textAnchor: 'start' | 'middle' | 'end',
  anchorX: number,
  advanceWidth: number,
): number {
  if (textAnchor === 'start') return anchorX;
  if (textAnchor === 'end') return anchorX - advanceWidth;
  return anchorX - advanceWidth / 2;
}
