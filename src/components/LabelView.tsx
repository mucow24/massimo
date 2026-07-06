import { useMemo } from 'react';
import type { Line, RouteBulletShape, TextLabel } from '../model/types';
import {
  BASELINE_FRACTION,
  LINE_HEIGHT,
  measureAdvance,
  measureTextLabel,
  type MeasuredBBox,
} from '../geometry/textMeasure';
import { justifyLine } from '../geometry/labelJustify';
import { resolveRunWeight, type SegmentStyle } from '../geometry/labelTokens';
import { TEXT_LABEL_HIT_PAD } from '../geometry/stationBoundary';
import { FONT_STACK } from '../util/fonts';
import { useDoc } from '../state/store';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { resolveTextLabelColor } from '../model/transforms';
import { InlineBullet } from './InlineBullet';
import { itemCursor } from './canvas/itemCursor';
import { SELECTION_STROKE_WIDTH, selectionDash } from './selectionStyle';

export type LabelLayer = 'bg' | 'stroke' | 'hit';

interface Props {
  label: TextLabel;
  selected: boolean;
  // Selection stroke is rendered in a second pass over the same labels so the
  // dashed ring sits above the network. The `bg` layer paints the visible text
  // plus an invisible hit rect (click + drag + contextmenu target). The
  // `stroke` layer paints only the dashed selection ring.
  layer?: LabelLayer;
  // Interaction handlers. All three default to no-op so the placement-preview
  // ghost can render the same component without wiring anything up.
  onPointerDown?: (id: string, e: React.PointerEvent) => void;
  onClick?: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  // Hand mode → grab cursor (pannable). Defaults false for non-canvas uses.
  inHandMode?: boolean;
}

// Per-line cursor X. Each line is positioned by its own ink bearings so the
// visible left/right ink edges align with the bbox edges — fonts at
// different weights have different side bearings, and we don't want that
// leakage to push the visible glyph row past the label's bbox.
function lineCursorX(
  align: TextLabel['align'],
  halfWidth: number,
  bearingLeft: number,
  bearingRight: number,
): number {
  if (align === 'right') return halfWidth - bearingRight;
  if (align === 'center') return (bearingLeft - bearingRight) / 2;
  // left
  return -halfWidth + bearingLeft;
}

export function LabelView({
  label,
  selected,
  layer = 'bg',
  onPointerDown,
  onClick,
  onContextMenu,
  inHandMode = false,
}: Props) {
  const docLines = useDoc((s) => s.lines);
  const themeColors = useThemeColors();
  const darkMode = useViewportStore((s) => s.darkMode);
  // Committed zoom: the selection ring divides by it so its screen weight is
  // constant (matches the polygon/bullet/silhouette selection chrome).
  const zoom = useViewportStore((s) => s.zoom);
  // Per-label day/night color (defaults match the old theme-driven colors).
  // The selection ring below still uses the theme's selectionStroke.
  const labelColor = resolveTextLabelColor(label, darkMode);
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(docLines)) map.set(ln.service, ln);
    return map;
  }, [docLines]);

  const m: MeasuredBBox = measureTextLabel(label);
  const angle = label.rotation * 45;
  const halfW = m.width / 2;
  const halfH = m.height / 2;
  const lineSpacing = label.fontSize * LINE_HEIGHT * (label.leading ?? 1);
  const letterSpacingPx = (label.tracking ?? 0) * label.fontSize;

  if (layer === 'stroke') {
    if (!selected) return null;
    return (
      <g
        transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
        pointerEvents="none"
        data-text-label-stroke={label.id}
      >
        <rect
          x={-halfW - TEXT_LABEL_HIT_PAD}
          y={-halfH - TEXT_LABEL_HIT_PAD}
          width={m.width + 2 * TEXT_LABEL_HIT_PAD}
          height={m.height + 2 * TEXT_LABEL_HIT_PAD}
          fill="none"
          stroke={themeColors.selectionStroke}
          strokeWidth={SELECTION_STROKE_WIDTH / zoom}
          strokeDasharray={selectionDash(zoom)}
        />
      </g>
    );
  }

  if (layer === 'hit') {
    // Transparent, top-z drag proxy for a SELECTED label: re-asserts the label's
    // bbox hit footprint above all map content so the selected label wins
    // pointer hit-testing over anything stacked above it. Routes to the same
    // move/click handlers. Skipped while locked (not draggable). Uses
    // data-text-label-hit (never data-text-label-id).
    if (!selected || label.locked) return null;
    return (
      <g
        transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
        data-text-label-hit={label.id}
        onPointerDown={onPointerDown ? (e) => onPointerDown(label.id, e) : undefined}
        onClick={onClick ? (e) => onClick(label.id, e) : undefined}
        onContextMenu={onContextMenu ? (e) => onContextMenu(label.id, e) : undefined}
        style={{ cursor: itemCursor(inHandMode, label.locked) }}
      >
        <rect
          x={-halfW - TEXT_LABEL_HIT_PAD}
          y={-halfH - TEXT_LABEL_HIT_PAD}
          width={m.width + 2 * TEXT_LABEL_HIT_PAD}
          height={m.height + 2 * TEXT_LABEL_HIT_PAD}
          fill="transparent"
        />
      </g>
    );
  }

  const interactive = !!(onPointerDown || onClick || onContextMenu);

  return (
    <g
      transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
      data-text-label-id={label.id}
      data-text-label-selected={selected || undefined}
      // Generic lock marker (shared with stations + polygons): the rect-select
      // gate keys off [data-locked] so a drag over a locked label begins a
      // marquee instead of doing nothing.
      data-locked={label.locked || undefined}
      onPointerDown={onPointerDown ? (e) => onPointerDown(label.id, e) : undefined}
      onClick={onClick ? (e) => onClick(label.id, e) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(label.id, e) : undefined}
      style={interactive ? { cursor: itemCursor(inHandMode, label.locked) } : undefined}
    >
      {/* Invisible hit rect covering the measured bbox + padding. Catches
          clicks, drags, and right-clicks anywhere inside the label's visual
          footprint — not just the glyphs. */}
      {interactive && (
        <rect
          x={-halfW - TEXT_LABEL_HIT_PAD}
          y={-halfH - TEXT_LABEL_HIT_PAD}
          width={m.width + 2 * TEXT_LABEL_HIT_PAD}
          height={m.height + 2 * TEXT_LABEL_HIT_PAD}
          fill="transparent"
        />
      )}
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        const yTop = -halfH + i * lineSpacing;
        // Bullet bottom sits on the text baseline; see BASELINE_FRACTION.
        const baselineY = yTop + label.fontSize * BASELINE_FRACTION;

        // Per-run style resolution for the formatting tags: <w=…>/<b> resolve
        // the weight against the label's base, <i> ORs with the label's italic,
        // <color=…> overrides the day/night label color for that run only.
        const runWeight = (style?: SegmentStyle) => resolveRunWeight(label.weight, style);
        const runItalic = (style?: SegmentStyle) => label.italic || !!style?.italic;
        const runFill = (style?: SegmentStyle) => style?.color ?? labelColor;
        const runAdvance = (s: string, style?: SegmentStyle) =>
          measureAdvance(s, label.fontSize, runWeight(style), runItalic(style), letterSpacingPx);

        const textNode = (x: number, value: string, key: string, style?: SegmentStyle) => (
          <text
            key={key}
            x={x}
            y={yTop}
            textAnchor="start"
            dominantBaseline="hanging"
            fontFamily={FONT_STACK}
            fontSize={label.fontSize}
            fontWeight={runWeight(style)}
            fontStyle={runItalic(style) ? 'italic' : 'normal'}
            letterSpacing={letterSpacingPx !== 0 ? letterSpacingPx : undefined}
            fill={runFill(style)}
            pointerEvents="none"
            style={{ userSelect: 'none', whiteSpace: 'pre' }}
          >
            {value}
          </text>
        );
        // <u>/<s> as explicit <line> geometry, matching the station-label
        // pattern: Chromium mishandles toggling the text-decoration SVG
        // attribute on rotated <text>, and svg2pdf ignores it outright.
        const decorationNodes = (
          x: number,
          width: number,
          key: string,
          style?: SegmentStyle,
        ): React.ReactNode[] => {
          if (!style || (!style.underline && !style.strike) || width <= 0) return [];
          const thickness = label.fontSize * 0.07;
          const decoration = (kind: string, y: number) => (
            <line
              key={`${key}-${kind}`}
              data-text-decoration={kind}
              x1={x}
              x2={x + width}
              y1={y}
              y2={y}
              stroke={runFill(style)}
              strokeWidth={thickness}
            />
          );
          const out: React.ReactNode[] = [];
          if (style.underline) out.push(decoration('underline', baselineY + label.fontSize * 0.1));
          if (style.strike) out.push(decoration('strike', baselineY - label.fontSize * 0.28));
          return out;
        };
        const bulletNode = (
          x: number,
          b: { code: string; shape: RouteBulletShape; filled: boolean; diameter: number },
          key: string,
        ) => (
          <InlineBullet
            key={key}
            code={b.code}
            shape={b.shape}
            filled={b.filled}
            diameter={b.diameter}
            cx={x + b.diameter / 2}
            cy={baselineY - b.diameter / 2}
            lineByService={lineByService}
          />
        );

        // Full-justify interior lines of a justified label: spread the words to
        // both box edges. The ragged last line of each paragraph
        // (`endsParagraph`) and any line with no interior gap return null and
        // fall through to the normal path, where lineCursorX left-flushes
        // 'justify' via its default branch.
        const atoms =
          label.align === 'justify' && !lm.endsParagraph
            ? justifyLine(lm.raw, label.fontSize, lm.inkWidth, m.width, runAdvance, lm.entryStyle)
            : null;

        const nodes: React.ReactNode[] = [];
        if (atoms) {
          const lineStartX = -halfW + lm.bearingLeft;
          atoms.forEach((a, j) => {
            const x = lineStartX + a.x;
            if (a.kind === 'text') {
              nodes.push(textNode(x, a.value ?? '', `${i}-${j}-t`, a.style));
              nodes.push(
                ...decorationNodes(x, runAdvance(a.value ?? '', a.style), `${i}-${j}`, a.style),
              );
            } else {
              nodes.push(
                bulletNode(
                  x,
                  {
                    code: a.code ?? '',
                    shape: a.shape ?? 'circle',
                    filled: a.filled ?? true,
                    diameter: a.diameter ?? 0,
                  },
                  `${i}-${j}-b`,
                ),
              );
            }
          });
        } else {
          let cursor = lineCursorX(label.align, halfW, lm.bearingLeft, lm.bearingRight);
          lm.segments.forEach((seg, j) => {
            const segCursor = cursor;
            cursor += seg.advance;
            if (seg.kind === 'text') {
              nodes.push(textNode(segCursor, seg.value, `${i}-${j}-t`, seg.style));
              nodes.push(...decorationNodes(segCursor, seg.advance, `${i}-${j}`, seg.style));
            } else {
              nodes.push(bulletNode(segCursor, seg, `${i}-${j}-b`));
            }
          });
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
