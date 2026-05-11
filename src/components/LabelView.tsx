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

// Per-line x offset that combines with text-anchor to anchor each <tspan> at
// the correct horizontal point given the label's align mode. The whole text
// block is centered on the label's origin, so the alignment anchor moves with
// the block.
function tspanXFor(align: TextLabel['align'], halfWidth: number): number {
  if (align === 'center') return 0;
  if (align === 'right') return halfWidth;
  return -halfWidth;
}

function textAnchorFor(align: TextLabel['align']): 'start' | 'middle' | 'end' {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
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
  const tspanX = tspanXFor(label.align, halfW);
  const anchor = textAnchorFor(label.align);

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
        textAnchor={anchor}
        dominantBaseline="hanging"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontSize={label.fontSize}
        fontWeight={label.weight}
        fontStyle={label.italic ? 'italic' : 'normal'}
        fill="#111"
        pointerEvents="none"
        style={{ userSelect: 'none', whiteSpace: 'pre' }}
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={tspanX} dy={i === 0 ? 0 : lineSpacing}>
            {ln === '' ? ' ' : ln}
          </tspan>
        ))}
      </text>
    </g>
  );
}
