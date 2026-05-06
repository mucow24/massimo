import { STOP_SIZE } from '../../geometry/orientation';
import type { SnapGuide } from '../../geometry/snap';

interface Props {
  guides: SnapGuide[];
  zoom: number;
}

/**
 * Snap-axis guide rendering: a soft halo behind + a dashed teal line on top
 * for each active alignment axis, plus circles at the endpoints. Stroke
 * widths are inverse to zoom so the guide stays visually consistent.
 */
export function SnapGuides({ guides, zoom }: Props) {
  if (guides.length === 0) return null;
  return (
    <g pointerEvents="none">
      <defs>
        <filter id="snap-halo-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={2 / zoom} />
        </filter>
      </defs>
      <g filter="url(#snap-halo-blur)">
        {guides.map((g, i) => (
          <g key={'halo' + i}>
            <line
              x1={g.from.x}
              y1={g.from.y}
              x2={g.to.x}
              y2={g.to.y}
              stroke="rgb(185, 218, 255)"
              strokeWidth={5 / zoom}
              strokeLinecap="round"
            />
            <circle
              cx={g.from.x}
              cy={g.from.y}
              r={STOP_SIZE * 0.28 + 1 / zoom}
              fill="none"
              stroke="rgb(185, 218, 255)"
              strokeWidth={5 / zoom}
            />
            <circle
              cx={g.to.x}
              cy={g.to.y}
              r={STOP_SIZE * 0.28 + 1 / zoom}
              fill="none"
              stroke="rgb(185, 218, 255)"
              strokeWidth={5 / zoom}
            />
          </g>
        ))}
      </g>
      {guides.map((g, i) => (
        <line
          key={'dash' + i}
          x1={g.from.x}
          y1={g.from.y}
          x2={g.to.x}
          y2={g.to.y}
          stroke="#1488a0"
          strokeWidth={2 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        />
      ))}
      {guides.map((g, i) => {
        if (!g.label) return null;
        // Position the label above the midpoint of the guide, offset
        // perpendicular by a small fixed screen-pixel amount so it sits
        // clear of the dotted line. "Above" = the side toward smaller y
        // (screen up) — the perpendicular flips to keep the label on top
        // regardless of the line's direction.
        const mx = (g.from.x + g.to.x) / 2;
        const my = (g.from.y + g.to.y) / 2;
        const dx = g.to.x - g.from.x;
        const dy = g.to.y - g.from.y;
        const len = Math.hypot(dx, dy) || 1;
        let px = -dy / len;
        let py = dx / len;
        if (py > 0) {
          px = -px;
          py = -py;
        }
        const offset = 9 / zoom;
        const lx = mx + px * offset;
        const ly = my + py * offset;
        return (
          <text
            key={'label' + i}
            x={lx}
            y={ly}
            fontSize={14 / zoom}
            fontWeight={700}
            fill="#000"
            stroke="#FCCC0A"
            strokeWidth={4 / zoom}
            paintOrder="stroke"
            textAnchor="middle"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {g.label}
          </text>
        );
      })}
    </g>
  );
}
