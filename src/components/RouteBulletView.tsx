import type { Line, RouteBullet } from '../model/types';
import { badgeColors } from './badge';
import { BulletShape } from './bulletShape';
import { useThemeColors } from '../state/theme';
import { itemCursor } from './canvas/itemCursor';
import { SELECTION_DASH, SELECTION_RING_PAD, selectionOutlineTones } from './selectionStyle';

interface Props {
  bullet: RouteBullet;
  lines: Record<string, Line>;
  selected: boolean;
  // 'full' (default) paints the colored badge + label + selection ring. 'hit'
  // (selected only) is a transparent top-z copy of the shape — the
  // selected-on-top drag proxy — painted above all map content so the bullet
  // wins pointer hits over anything stacked above it.
  layer?: 'full' | 'hit';
  // Hand mode → grab cursor (pannable). Defaults false for non-canvas uses.
  inHandMode?: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}

export function RouteBulletView({
  bullet,
  lines,
  selected,
  layer = 'full',
  inHandMode = false,
  onPointerDown,
  onClick,
  onContextMenu,
}: Props) {
  // Two-tone selection ring flips with the theme (WBW on light, BWB on dark).
  const themeColors = useThemeColors();
  const {
    fill,
    textColor,
    code: service,
  } = badgeColors(bullet.lineId ? lines[bullet.lineId] : null);
  const r = bullet.size;
  const angle = bullet.rotation * 45;

  // Shape geometry, parameterized by fill so the transparent hit proxy reuses the
  // exact footprint (circle / square / diamond) the badge paints.
  const renderShape = (shapeFill: string) => (
    <BulletShape shape={bullet.shape} r={r} fill={shapeFill} />
  );

  if (layer === 'hit') {
    if (!selected || bullet.locked) return null;
    return (
      <g
        data-bullet-hit={bullet.id}
        transform={`translate(${bullet.x} ${bullet.y}) rotate(${angle})`}
        onPointerDown={(e) => onPointerDown(bullet.id, e)}
        onClick={(e) => onClick(bullet.id, e)}
        onContextMenu={(e) => onContextMenu(bullet.id, e)}
        style={{ cursor: itemCursor(inHandMode, bullet.locked) }}
      >
        {renderShape('transparent')}
      </g>
    );
  }

  const shape = renderShape(fill);
  const fontSize = r * 1.1;

  return (
    <g
      data-bullet-id={bullet.id}
      data-bullet-selected={selected || undefined}
      // Generic lock marker (shared with stations + polygons): the rect-select
      // gate keys off [data-locked] so a drag over a locked bullet begins a
      // marquee instead of doing nothing.
      data-locked={bullet.locked || undefined}
      // Locked + unselected → click-through: lock means "this is background —
      // stop catching my clicks", so clicks land on whatever is beneath.
      // Selection keeps a locked bullet clickable so the popover's unlock
      // toggle stays reachable.
      pointerEvents={bullet.locked && !selected ? 'none' : undefined}
      transform={`translate(${bullet.x} ${bullet.y}) rotate(${angle})`}
      onPointerDown={(e) => onPointerDown(bullet.id, e)}
      onClick={(e) => onClick(bullet.id, e)}
      onContextMenu={(e) => onContextMenu(bullet.id, e)}
      style={{ cursor: itemCursor(inHandMode, bullet.locked) }}
    >
      {shape}
      {selected &&
        selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
          <circle
            key={tone}
            // Editor chrome, not content: without this the ring bakes into
            // SVG/PNG exports (bullets render in a non-excluded pass).
            data-export-exclude="1"
            cx={0}
            cy={0}
            // World-unit pad (scales with the map — reads as attached to the
            // bullet); the two-tone stroke holds its screen weight via
            // vector-effect, so nothing divides by zoom and nothing snaps.
            r={r + SELECTION_RING_PAD}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={SELECTION_DASH}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill={textColor}
        pointerEvents="none"
        style={{ userSelect: 'none' }}
      >
        {service}
      </text>
    </g>
  );
}
