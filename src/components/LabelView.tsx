import { useMemo } from 'react';
import type { Line, TextLabel } from '../model/types';
import { LINE_HEIGHT, measureTextLabel, type MeasuredBBox } from '../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../geometry/stationBoundary';
import { useDoc } from '../state/store';
import { legibleTextOn } from '../util/color';

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
        const yTop = -halfH + i * lineSpacing;
        // Bullet sits with its bottom on the text baseline. SVG's `hanging`
        // baseline puts y at the text top; the baseline is roughly 0.8 *
        // fontSize down (em-ascent for Helvetica-like fonts).
        const baseline = yTop + label.fontSize * 0.8;
        const lineStartX = lineCursorX(label.align, halfW, lm.bearingLeft, lm.bearingRight);
        if (lm.segments.length === 0) {
          // Empty line — still emit a stub so the SVG tree shape matches
          // line count for snapshot/debug tools.
          return <g key={i} data-empty-line="" />;
        }
        let cursor = lineStartX;
        const nodes: React.ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
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
                fill="#111"
                pointerEvents="none"
                style={{ userSelect: 'none', whiteSpace: 'pre' }}
              >
                {seg.value}
              </text>,
            );
          } else {
            const r = seg.diameter / 2;
            const bulletCY = baseline - r;
            const line = lineByService.get(seg.code);
            const fill = line?.color ?? '#888';
            const textColor = line ? legibleTextOn(fill) : '#fff';
            const code = line?.service ?? '?';
            nodes.push(
              <g
                key={`${i}-${j}-b`}
                transform={`translate(${segCursor + r} ${bulletCY})`}
                pointerEvents="none"
              >
                <circle cx={0} cy={0} r={r} fill={fill} />
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
                  fontSize={r * 1.1}
                  fontWeight={700}
                  fill={textColor}
                  style={{ userSelect: 'none' }}
                >
                  {code}
                </text>
              </g>,
            );
          }
          cursor += seg.advance;
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
