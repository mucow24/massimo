import type { TextLabel } from '../model/types';
import { LINE_HEIGHT, measureTextLabel, type MeasuredBBox } from '../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../geometry/stationBoundary';

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
  const m: MeasuredBBox = measureTextLabel(label);
  const angle = label.rotation * 45;
  const halfW = m.width / 2;
  const halfH = m.height / 2;
  const lines = label.text.length === 0 ? [''] : label.text.split('\n');
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
      <text
        x={0}
        y={-halfH}
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
        {lines.map((ln, i) => {
          const lm = m.lines[i] ?? { bearingLeft: 0, bearingRight: 0, inkWidth: 0 };
          const cursorX = lineCursorX(label.align, halfW, lm.bearingLeft, lm.bearingRight);
          return (
            <tspan key={i} x={cursorX} dy={i === 0 ? 0 : lineSpacing}>
              {ln === '' ? ' ' : ln}
            </tspan>
          );
        })}
      </text>
    </g>
  );
}
