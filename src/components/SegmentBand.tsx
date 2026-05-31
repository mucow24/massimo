import { Fragment } from 'react';
import { resolveSegmentStyle, SegmentBandSpec } from '../geometry/interlining';
import { STOP_SIZE } from '../geometry/orientation';
import type { Line, LineId } from '../model/types';
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
  // Live line map. Color and per-segment style are resolved from here at
  // render time (the spec is presentation-free), so edits repaint without a
  // geometry rebuild.
  lines: Record<LineId, Line>;
  // Optional per-line color override (e.g. for desaturating non-selected lines).
  colorMap?: Record<LineId, string>;
  // Gap/underlay color for non-solid styles; matches the canvas background.
  underlayColor?: string;
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
  lines,
  colorMap,
  underlayColor,
}: Props) {
  const lineId = spec.lines[stripeIndex].id;
  const d = spec.paths[stripeIndex];
  const live = lines[lineId];
  // Resolve presentation live (spec carries only the id): desaturation
  // override wins for color, then the line's own color; style is the
  // per-segment resolution keyed on this band's pairKey.
  const color = colorMap?.[lineId] ?? live.color;
  const style = resolveSegmentStyle(live, spec.pairKey);
  const selectable = !interactive && !!onLineSelect;
  const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(style, color);
  const underlay = lineStyleUnderlayAttrs(style, underlayColor);
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

// Warning decoration for a band the router couldn't route cleanly. When a
// band warns, its centerline collapses to a straight start→end segment (see
// route()), which we paint as a crude straight line. Here we frame that bad
// segment with a 2px red outline and drop a ⚠ glyph over its exact center.
//
// Rendered in a dedicated top-most layer (see MapCanvas) — not interleaved
// with the stripes — so the glyph sits above every stripe, dot, and label and
// can never be occluded.
//
// `iconColor` is the glyph fill — the caller passes whichever of black/white
// is more legible against the stripe beneath the glyph's center (via
// legibleTextOn). Defaults to black for standalone/test renders.
export function BandWarning({
  spec,
  iconColor = '#000',
}: {
  spec: SegmentBandSpec;
  iconColor?: string;
}) {
  const verts = spec.centerline;
  if (!spec.warning || verts.length < 2) return null;
  const a = verts[0];
  const b = verts[verts.length - 1];
  // Unit vector along the segment and its left-perpendicular. The bad segment
  // spans n stripes of STOP_SIZE each, so its half-width is n·STOP_SIZE / 2.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = dy / len;
  const py = -dx / len;
  const hw = (spec.lines.length * STOP_SIZE) / 2;
  const corner = (p: { x: number; y: number }, sign: number) =>
    `${p.x + px * hw * sign} ${p.y + py * hw * sign}`;
  // Rectangle tracing the band's perimeter; the 2px stroke straddles the edge.
  const outline = `M ${corner(a, 1)} L ${corner(b, 1)} L ${corner(b, -1)} L ${corner(a, -1)} Z`;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  return (
    <g pointerEvents="none">
      {/* 1px white core over a 3px red stroke: paint the red stroke first,
          then the white stroke centered on top. */}
      <path d={outline} fill="none" stroke="#d00" strokeWidth={3} strokeLinejoin="round" />
      <path d={outline} fill="none" stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
      <text
        x={cx}
        y={cy}
        fontSize={14}
        fill={iconColor}
        textAnchor="middle"
        dominantBaseline="central"
      >
        ⚠
      </text>
    </g>
  );
}
