import type { Line, RouteBullet } from '../model/types';
import { badgeColors } from './badge';
import { capCenterDy } from '../geometry/textMeasure';
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
  // Canvas mouseover → preview this bullet's selection ring at 50% (see
  // MapCanvas). Only the full layer wires them; the id lets leave no-op when the
  // hover already moved on. Optional so the hit proxy / non-canvas uses skip them.
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
}

/**
 * A route bullet's two-tone dashed selection ring (a circle at r + pad),
 * centered on the bullet's local origin — no transform of its own. Shared by
 * the selected badge and the hovered-bullet preview so both draw the identical
 * ring. Carries data-export-exclude: editor chrome, not content.
 */
function BulletRingCircles({ bullet }: { bullet: RouteBullet }) {
  const themeColors = useThemeColors();
  return (
    <>
      {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
        <circle
          key={tone}
          data-export-exclude="1"
          cx={0}
          cy={0}
          // World-unit pad (scales with the map — reads as attached to the
          // bullet); the two-tone stroke holds its screen weight via
          // vector-effect, so nothing divides by zoom and nothing snaps.
          r={bullet.size + SELECTION_RING_PAD}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={SELECTION_DASH}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/**
 * The bullet's selection ring, self-positioned in world coords. A hovered
 * (unselected) bullet renders JUST this at 50% opacity for the mouseover
 * preview.
 */
export function RouteBulletSelectionRing({ bullet }: { bullet: RouteBullet }) {
  return (
    <g
      transform={`translate(${bullet.x} ${bullet.y}) rotate(${bullet.rotation * 45})`}
      pointerEvents="none"
    >
      <BulletRingCircles bullet={bullet} />
    </g>
  );
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
  onHoverEnter,
  onHoverLeave,
}: Props) {
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
      onPointerEnter={onHoverEnter ? () => onHoverEnter(bullet.id) : undefined}
      onPointerLeave={onHoverLeave ? () => onHoverLeave(bullet.id) : undefined}
      style={{ cursor: itemCursor(inHandMode, bullet.locked) }}
    >
      {shape}
      {selected && <BulletRingCircles bullet={bullet} />}
      <text
        x={0}
        // Cap-centered on the alphabetic baseline — NOT dominantBaseline="central",
        // which resolves from platform-specific font metrics (see capCenterDy).
        y={capCenterDy(fontSize)}
        textAnchor="middle"
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
