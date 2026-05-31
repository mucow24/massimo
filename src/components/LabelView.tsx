import { useMemo } from 'react';
import type { Line, TextLabel } from '../model/types';
import {
  BASELINE_FRACTION,
  LINE_HEIGHT,
  measureTextLabel,
  type MeasuredBBox,
} from '../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../geometry/stationBoundary';
import { useDoc } from '../state/store';
import { useThemeColors } from '../state/theme';
import { InlineBullet } from './InlineBullet';

export type LabelLayer = 'bg' | 'stroke';

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
}

const SELECTION_STROKE_COLOR = '#000000';
const SELECTION_STROKE_WIDTH = 2;
const SELECTION_DASH = '4 3';

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
}: Props) {
  const docLines = useDoc((s) => s.lines);
  const labelColor = useThemeColors().label;
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(docLines)) map.set(ln.service, ln);
    return map;
  }, [docLines]);

  const m: MeasuredBBox = measureTextLabel(label);
  const angle = label.rotation * 45;
  const halfW = m.width / 2;
  const halfH = m.height / 2;
  const lineSpacing = label.fontSize * LINE_HEIGHT;

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
          stroke={SELECTION_STROKE_COLOR}
          strokeWidth={SELECTION_STROKE_WIDTH}
          strokeDasharray={SELECTION_DASH}
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
      onPointerDown={onPointerDown ? (e) => onPointerDown(label.id, e) : undefined}
      onClick={onClick ? (e) => onClick(label.id, e) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(label.id, e) : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
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
        const lineStartX = lineCursorX(label.align, halfW, lm.bearingLeft, lm.bearingRight);
        let cursor = lineStartX;
        const nodes: React.ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
          cursor += seg.advance;
          if (seg.kind === 'text') {
            nodes.push(
              <text
                key={`${i}-${j}-t`}
                x={segCursor}
                y={yTop}
                textAnchor="start"
                dominantBaseline="hanging"
                fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
                fontSize={label.fontSize}
                fontWeight={label.weight}
                fontStyle={label.italic ? 'italic' : 'normal'}
                fill={labelColor}
                pointerEvents="none"
                style={{ userSelect: 'none', whiteSpace: 'pre' }}
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
                diameter={seg.diameter}
                cx={segCursor + r}
                cy={baselineY - r}
                lineByService={lineByService}
              />,
            );
          }
        });
        return (
          <g key={i} data-label-line={i}>
            {nodes}
          </g>
        );
      })}
    </g>
  );
}
