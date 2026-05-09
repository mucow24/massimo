import { Fragment } from 'react';
import { SegmentBandSpec } from '../geometry/interlining';
import type { LineId } from '../model/types';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';

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
        const line = spec.lines[i];
        const lineId = line.id;
        const color = colorMap?.[lineId] ?? line.color;
        const selectable = !interactive && !!onLineSelect;
        const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(line.style, color);
        const underlay = lineStyleUnderlayAttrs(line.style);
        return (
          <Fragment key={lineId}>
            {underlay && (
              <path
                d={d}
                fill="none"
                stroke={underlay.stroke}
                strokeWidth={14}
                strokeLinecap={underlay.strokeLinecap}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={14}
              strokeLinecap={strokeLinecap}
              strokeLinejoin="round"
              strokeDasharray={strokeDasharray}
              pointerEvents={interactive || selectable ? 'stroke' : undefined}
              style={
                interactive
                  ? { cursor: 'crosshair' }
                  : selectable
                    ? { cursor: 'pointer' }
                    : undefined
              }
              onPointerMove={interactive && onLineHover ? (e) => onLineHover(lineId, e) : undefined}
              onPointerLeave={
                interactive && onLineLeave ? (e) => onLineLeave(lineId, e) : undefined
              }
              onClick={
                interactive && onLineClick
                  ? (e) => onLineClick(lineId, e)
                  : selectable
                    ? (e) => onLineSelect!(lineId, e)
                    : undefined
              }
            />
          </Fragment>
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
