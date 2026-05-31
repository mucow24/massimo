import type { Line, RouteBullet } from '../model/types';
import { badgeColors } from './badge';
import { useThemeColors } from '../state/theme';

interface Props {
  bullet: RouteBullet;
  lines: Record<string, Line>;
  selected: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}

export function RouteBulletView({
  bullet,
  lines,
  selected,
  onPointerDown,
  onClick,
  onContextMenu,
}: Props) {
  const themeColors = useThemeColors();
  const {
    fill,
    textColor,
    code: service,
  } = badgeColors(bullet.lineId ? lines[bullet.lineId] : null);
  const r = bullet.size;
  const angle = bullet.rotation * 45;

  let shape: React.ReactNode;
  if (bullet.shape === 'circle') {
    shape = <circle cx={0} cy={0} r={r} fill={fill} />;
  } else if (bullet.shape === 'square') {
    shape = <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} />;
  } else {
    // Diamond.
    shape = <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} fill={fill} />;
  }

  const fontSize = r * 1.1;

  return (
    <g
      data-bullet-id={bullet.id}
      data-bullet-selected={selected || undefined}
      transform={`translate(${bullet.x} ${bullet.y}) rotate(${angle})`}
      onPointerDown={(e) => onPointerDown(bullet.id, e)}
      onClick={(e) => onClick(bullet.id, e)}
      onContextMenu={(e) => onContextMenu(bullet.id, e)}
      style={{ cursor: 'pointer' }}
    >
      {shape}
      {selected && (
        <circle
          cx={0}
          cy={0}
          r={r + 3}
          fill="none"
          stroke={themeColors.selectionStroke}
          strokeWidth={2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
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
