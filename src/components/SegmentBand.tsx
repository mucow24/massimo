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
  // Default-mode click handler: selects a line by clicking its stripe.
  onLineSelect?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
  // Optional per-line color override (e.g. for desaturating non-selected lines).
  colorMap?: Record<LineId, string>;
}

export function SegmentBand({
  spec,
  interactive = false,
  onLineHover,
  onLineLeave,
  onLineClick,
  onLineSelect,
  colorMap,
}: Props) {
  return (
    <g>
      {spec.paths.map((d, i) => {
        const lineId = spec.lines[i].id;
        const color = colorMap?.[lineId] ?? spec.lines[i].color;
        const selectable = !interactive && !!onLineSelect;
        return (
          <path
            key={lineId}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={14}
            strokeLinecap="square"
            strokeLinejoin="round"
            pointerEvents={interactive || selectable ? 'stroke' : undefined}
            style={
              interactive
                ? { cursor: 'crosshair' }
                : selectable
                  ? { cursor: 'pointer' }
                  : undefined
            }
            onPointerMove={interactive && onLineHover ? (e) => onLineHover(lineId, e) : undefined}
            onPointerLeave={interactive && onLineLeave ? (e) => onLineLeave(lineId, e) : undefined}
            onClick={
              interactive && onLineClick
                ? (e) => onLineClick(lineId, e)
                : selectable
                  ? (e) => onLineSelect!(lineId, e)
                  : undefined
            }
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
