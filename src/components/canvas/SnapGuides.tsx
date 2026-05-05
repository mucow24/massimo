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
    </g>
  );
}
