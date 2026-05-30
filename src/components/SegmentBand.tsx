import { Fragment } from 'react';
import { SegmentBandSpec } from '../geometry/interlining';
import type { LineId } from '../model/types';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';

interface Props {
  spec: SegmentBandSpec;
  // Which stripe within `spec.paths`/`spec.lines` to render. Bands are
  // emitted as one renderable per stripe so each can paint at its own line's
  // z-priority — see buildOrderedRenderables.
  stripeIndex: number;
  // When `interactive` is true, the stripe captures pointer events on its
  // stroke and forwards them via the per-line callbacks. Used to wire up
  // hover-to-preview and click-to-insert in add-line-tag mode.
  interactive?: boolean;
  onLineHover?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineLeave?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineClick?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
  onLineContextMenu?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
  // Default-mode click handler: selects a line by clicking its stripe.
  onLineSelect?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
  // Optional per-line color override (e.g. for desaturating non-selected lines).
  colorMap?: Record<LineId, string>;
}

export function SegmentBand({
  spec,
  stripeIndex,
  interactive = false,
  onLineHover,
  onLineLeave,
  onLineClick,
  onLineContextMenu,
  onLineSelect,
  colorMap,
}: Props) {
  const line = spec.lines[stripeIndex];
  const d = spec.paths[stripeIndex];
  const lineId = line.id;
  const color = colorMap?.[lineId] ?? line.color;
  const selectable = !interactive && !!onLineSelect;
  const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(line.style, color);
  const underlay = lineStyleUnderlayAttrs(line.style);
  return (
    <Fragment>
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
        data-band-stripe
        data-band-key={spec.bandKey}
        data-line-id={lineId}
        fill="none"
        stroke={stroke}
        strokeWidth={14}
        strokeLinecap={strokeLinecap}
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
        pointerEvents={interactive || selectable ? 'stroke' : undefined}
        style={
          interactive ? { cursor: 'crosshair' } : selectable ? { cursor: 'pointer' } : undefined
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
        onContextMenu={
          interactive && onLineContextMenu ? (e) => onLineContextMenu(lineId, e) : undefined
        }
      />
    </Fragment>
  );
}

// Centerline ⚠ glyph for a band with a routing warning. Rendered as its own
// renderable so its z-position can be picked independently of the stripes
// (paints at the band's front-most stripe priority — see buildOrderedRenderables).
export function BandWarning({ spec }: { spec: SegmentBandSpec }) {
  if (!spec.warning || spec.centerline.length === 0) return null;
  const mid = spec.centerline[Math.floor(spec.centerline.length / 2)];
  return (
    <text x={mid.x} y={mid.y - 4} fontSize={14} fill="#a22" textAnchor="middle">
      ⚠
    </text>
  );
}
