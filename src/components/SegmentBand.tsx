import { SegmentBandSpec } from '../geometry/interlining';
import type { LineId } from '../model/types';

interface Props {
  spec: SegmentBandSpec;
  // When `interactive` is true, each stripe path captures pointer events on
  // its stroke and forwards them via the per-line callbacks. Used to wire up
  // hover-to-preview and click-to-insert in add-line-tag mode. When false,
  // bands are inert (default).
  interactive?: boolean;
  onLineHover?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineLeave?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineClick?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
}

export function SegmentBand({
  spec,
  interactive = false,
  onLineHover,
  onLineLeave,
  onLineClick,
}: Props) {
  return (
    <g>
      {spec.paths.map((d, i) => {
        const lineId = spec.lines[i].id;
        return (
          <path
            key={lineId}
            d={d}
            fill="none"
            stroke={spec.lines[i].color}
            strokeWidth={14}
            strokeLinecap="square"
            strokeLinejoin="round"
            pointerEvents={interactive ? 'stroke' : undefined}
            style={interactive ? { cursor: 'crosshair' } : undefined}
            onPointerMove={interactive && onLineHover ? (e) => onLineHover(lineId, e) : undefined}
            onPointerLeave={interactive && onLineLeave ? (e) => onLineLeave(lineId, e) : undefined}
            onClick={interactive && onLineClick ? (e) => onLineClick(lineId, e) : undefined}
          />
        );
      })}
      {spec.warning && spec.centerline.length > 0 && (
        <text
          x={spec.centerline[Math.floor(spec.centerline.length / 2)].x}
          y={spec.centerline[Math.floor(spec.centerline.length / 2)].y - 4}
          fontSize={14}
          fill="#a22"
          textAnchor="middle"
        >
          ⚠
        </text>
      )}
    </g>
  );
}
