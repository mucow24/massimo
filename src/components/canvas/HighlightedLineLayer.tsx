import { Fragment, type ComponentProps, type ReactNode } from 'react';
import type { Line, LineId, Station, StationId, StopCell } from '../../model/types';
import type { UiMode } from '../../state/selection';
import {
  resolveSegmentStyle,
  stopPosWorld,
  type OrderedRenderable,
} from '../../geometry/interlining';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotShape } from '../../model/transforms';
import { STOP_SIZE, travelDirLocal, rotateBy } from '../../geometry/orientation';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';
import { offsetFilletPath } from '../../geometry/router';
import { lineStrokeColorOf, lineStrokeRailWidth, lineStrokeWidthOf } from '../../model/lineStroke';
import { lineWidthOf } from '../../model/lineWidth';
import { StopMarker } from '../StopMarker';
import { StopGlyph } from '../StopGlyph';
import { StationView } from '../StationView';
import { legibleTextOn } from '../../util/color';

/**
 * SVG path for a small isoceles arrow pointing along the unit vector (dx, dy)
 * from (ox, oy). The base (width 2*halfW) sits `baseDist` from the origin, the
 * apex `apexDist` from it. Swapping base/apex distances flips the arrow 180°.
 */
export function arrowTrianglePath(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  baseDist: number,
  apexDist: number,
  halfW: number,
): string {
  const px = -dy;
  const py = dx;
  const baseCx = ox + dx * baseDist;
  const baseCy = oy + dy * baseDist;
  const apexX = ox + dx * apexDist;
  const apexY = oy + dy * apexDist;
  const lX = baseCx + px * halfW;
  const lY = baseCy + py * halfW;
  const rX = baseCx - px * halfW;
  const rY = baseCy - py * halfW;
  return `M ${apexX} ${apexY} L ${lX} ${lY} L ${rX} ${rY} Z`;
}

// Dim wash applied over the whole map when one line is "highlighted" (selected),
// so the chosen line reads above everything else.
const DIM_COLOR = '#000000';
const DIM_ALPHA = 0.75;

interface Props {
  highlightLineId: LineId;
  lines: Record<LineId, Line>;
  stations: Record<StationId, Station>;
  renderables: OrderedRenderable[];
  underlayColor: string;
  hoveredInspectorSegment: {
    lineId: LineId;
    fromStationId: StationId;
    toStationId: StationId;
  } | null;
  uiMode: UiMode;
  zoom: number;
  onStartDrag: ComponentProps<typeof StationView>['onStartDrag'];
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
}

// The selected-line highlight: a dim overlay plus the chosen line re-painted on
// top (stripes, stop markers, direction triangles, names), with append-mode
// affordances when adding stations. Extracted verbatim from MapCanvas; the only
// change is that the closed-over locals are now explicit props.
export function HighlightedLineLayer({
  highlightLineId,
  lines,
  stations,
  renderables,
  underlayColor,
  hoveredInspectorSegment,
  uiMode,
  zoom,
  onStartDrag,
  vbX,
  vbY,
  vbW,
  vbH,
}: Props) {
  return (
    <>
      {DIM_ALPHA > 0 && (
        <rect
          x={vbX}
          y={vbY}
          width={vbW}
          height={vbH}
          fill={DIM_COLOR}
          fillOpacity={DIM_ALPHA}
          pointerEvents="none"
        />
      )}
      <g pointerEvents="none" data-highlight-layer={highlightLineId}>
        {(() => {
          const ln = lines[highlightLineId];
          if (!ln) return null;
          const hov = hoveredInspectorSegment;
          const hovPairKey = hov ? pairKeyOf(hov.fromStationId, hov.toStationId) : null;
          const isHoverStation = (sid: string) =>
            !!hov && (sid === hov.fromStationId || sid === hov.toStationId);
          // Two buckets so dimmed stripe + colored stop square + direction
          // triangle at one station composite *together* into one isolated
          // group (children overdraw normally, then the group composites
          // once at 0.2). Without this each dimmed element composites to
          // the background separately and you see the stripe tinting
          // through the marker, the marker tinting through the triangle,
          // etc. When no divider is hovered, everything goes into the
          // matched bucket and renders flat.
          const dimmed: ReactNode[] = [];
          const matched: ReactNode[] = [];
          const push = (m: boolean, node: ReactNode) => (m || !hov ? matched : dimmed).push(node);
          renderables.forEach((r, i) => {
            if (r.kind !== 'stripe') return;
            const stripeLn = r.band.lines[r.stripeIndex];
            if (stripeLn.id !== highlightLineId) return;
            // Presentation resolved live from the highlighted line (the
            // spec carries only the id); style is per-segment via pairKey.
            const style = resolveSegmentStyle(ln, r.band.pairKey);
            const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
              style,
              ln.color,
            );
            const underlay = lineStyleUnderlayAttrs(style, underlayColor);
            const stripeW = r.band.stripeWidths[r.stripeIndex];
            const railW = lineStrokeRailWidth(lineStrokeWidthOf(ln), stripeW);
            const m = !!hov && hov.lineId === stripeLn.id && r.band.pairKey === hovPairKey;
            push(
              m,
              <Fragment key={'hl-b:' + i}>
                {underlay && (
                  <path
                    d={r.band.paths[r.stripeIndex]}
                    fill="none"
                    stroke={underlay.stroke}
                    strokeWidth={stripeW}
                    strokeLinecap={underlay.strokeLinecap}
                    strokeLinejoin="round"
                  />
                )}
                <path
                  d={r.band.paths[r.stripeIndex]}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={stripeW}
                  strokeLinecap={strokeLinecap}
                  strokeLinejoin="round"
                  strokeDasharray={strokeDasharray}
                />
                {/* Casing rails centered on the body edges, mirroring
                    SegmentBand. */}
                {railW > 0 &&
                  [-1, 1].map((side) => (
                    <path
                      key={side}
                      d={offsetFilletPath(
                        r.band.centerline,
                        r.band.radius,
                        r.band.stripeOffsets[r.stripeIndex] + (side * stripeW) / 2,
                      )}
                      fill="none"
                      stroke={lineStrokeColorOf(ln)}
                      strokeWidth={railW}
                      strokeLinecap="butt"
                      strokeLinejoin="round"
                    />
                  ))}
              </Fragment>,
            );
          });
          // The arrow-tip station (last stop with ≥2 stops on the line):
          // its cased arrowhead replaces the line's end, so the marker's
          // end-cap rail is suppressed there — one smooth border from body
          // into arrow.
          const stopsOnLine = ln.stations.filter((sid) =>
            stations[sid]?.stops.some((c) => c.lineId === highlightLineId),
          );
          const arrowTipSid = stopsOnLine.length >= 2 ? stopsOnLine[stopsOnLine.length - 1] : null;
          renderables.forEach((r, i) => {
            if (r.kind !== 'marker' || r.spec.lineId !== highlightLineId) return;
            push(
              isHoverStation(r.spec.stationId),
              <StopMarker
                key={'hl-m:' + i}
                spec={r.spec}
                underlayColor={underlayColor}
                lines={lines}
                noEndCap={r.spec.stationId === arrowTipSid}
              />,
            );
          });
          // Direction triangles: small arrow ~5px past each stop dot
          // pointing along the stop's own travel direction.
          type P = { sid: string; x: number; y: number; st: Station; cell: StopCell };
          const points: P[] = [];
          for (const sid of ln.stations) {
            const st = stations[sid];
            if (!st) continue;
            const cell = st.stops.find((c) => c.lineId === highlightLineId);
            if (!cell) continue;
            const world = stopPosWorld(cell, st);
            points.push({ sid, st, cell, x: world.x, y: world.y });
          }
          if (points.length >= 2) {
            const dotR = STOP_SIZE * 0.28;
            const gap = 2;
            const halfW = 3;
            const height = 5;
            const baseDist = dotR + gap;
            const apexDist = baseDist + height;
            points.forEach((p, i) => {
              // Hint resolves auto-* sign; for explicit orientations it's
              // ignored. Use the segment toward the next stop (or back from
              // the previous stop at the terminus).
              const ref = i < points.length - 1 ? points[i + 1] : points[i - 1];
              const sign = i < points.length - 1 ? 1 : -1;
              const worldHint = { x: (ref.x - p.x) * sign, y: (ref.y - p.y) * sign };
              const aInv = -(p.st.rotation * Math.PI) / 4;
              const ci = Math.cos(aInv);
              const si = Math.sin(aInv);
              const localHint = {
                x: worldHint.x * ci - worldHint.y * si,
                y: worldHint.x * si + worldHint.y * ci,
              };
              const localDir = travelDirLocal(p.cell.orientation, localHint);
              const worldDir = rotateBy(localDir, p.st.rotation);
              const dx = worldDir.x;
              const dy = worldDir.y;
              const isTerminus = i === points.length - 1;
              // A stroked line's terminus arrow gets a casing rim too: an
              // underlay copy fattened by 2× the line's stroke width in the
              // stroke color, so the arrow reads as part of the cased line.
              const arrowStroke = isTerminus ? lineStrokeWidthOf(ln) : 0;
              const bodyW = lineWidthOf(ln);
              const railW = lineStrokeRailWidth(arrowStroke, bodyW);
              const d = arrowTrianglePath(p.x, p.y, dx, dy, baseDist, apexDist, halfW);
              push(
                isHoverStation(p.sid),
                <Fragment key={'hl-tri:' + p.sid}>
                  {arrowStroke > 0 && (
                    <path
                      d={d}
                      fill={lineStrokeColorOf(ln)}
                      stroke={lineStrokeColorOf(ln)}
                      strokeWidth={10 + 2 * arrowStroke}
                      strokeLinejoin="miter"
                      paintOrder="stroke fill"
                    />
                  )}
                  <path
                    d={d}
                    fill={isTerminus ? ln.color : '#000'}
                    stroke={isTerminus ? ln.color : undefined}
                    strokeWidth={isTerminus ? 10 : undefined}
                    strokeLinejoin={isTerminus ? 'miter' : undefined}
                    paintOrder={isTerminus ? 'stroke fill' : undefined}
                  />
                  {/* Junction patch: the underlay is a CLOSED triangle, so
                      its fattened stroke also rims the arrow's BASE edge —
                      a stroke-colored bar across the body where the arrow
                      overlaps it. Repaint the body color between the rails
                      (width − rail wide) from just behind the stop into the
                      arrow base, so the body flows seamlessly into the
                      arrowhead while the rim survives only around the
                      arrow's exposed silhouette. */}
                  {arrowStroke > 0 && (
                    <line
                      x1={p.x - dx * railW}
                      y1={p.y - dy * railW}
                      x2={p.x + dx * baseDist}
                      y2={p.y + dy * baseDist}
                      stroke={ln.color}
                      strokeWidth={bodyW - railW}
                      strokeLinecap="butt"
                    />
                  )}
                </Fragment>,
              );
            });
          }
          // Re-render the selected line's stop dots on top so the colored
          // markers and direction triangles don't swallow them.
          for (const sid of ln.stations) {
            const st = stations[sid];
            if (!st) continue;
            const cell = st.stops.find((c) => c.lineId === highlightLineId);
            if (!cell) continue;
            const { x: cx, y: cy } = stopPosWorld(cell, st);
            push(
              isHoverStation(sid),
              <StopGlyph
                key={'hl-d:' + sid}
                cx={cx}
                cy={cy}
                shape={resolveDotShape(ln, cell)}
                lineColor={ln.color}
                stationId={sid}
                lineId={cell.lineId}
              />,
            );
          }
          // Selected line's station names rendered in white above dim.
          // The append-mode "starter" station gets its own treatment
          // below (line-color name + arrowhead), so skip it here.
          const append = uiMode.kind === 'appending-to-line' ? uiMode : null;
          const starterId =
            append &&
            append.lineId === highlightLineId &&
            append.insertAfterIndex != null &&
            append.insertAfterIndex >= 0
              ? ln.stations[append.insertAfterIndex]
              : null;
          for (const sid of ln.stations) {
            if (sid === starterId) continue;
            const st = stations[sid];
            if (!st) continue;
            push(
              isHoverStation(sid),
              <StationView
                key={'hl-l:' + sid}
                station={st}
                lines={lines}
                zoom={zoom}
                onStartDrag={onStartDrag}
                layer="highlight-label"
              />,
            );
          }
          return (
            <>
              {dimmed.length > 0 && <g opacity={0.2}>{dimmed}</g>}
              {matched}
            </>
          );
        })()}
        {/* In append mode, surface stations not yet on the line as
                light gray labels above the dim, plus highlight the
                "starter" stop and draw an arrowhead pointing at where
                the next station will be inserted. */}
        {uiMode.kind === 'appending-to-line' &&
          uiMode.lineId === highlightLineId &&
          (() => {
            const append = uiMode;
            if (append.kind !== 'appending-to-line') return null;
            const ln = lines[highlightLineId];
            if (!ln) return null;
            const onLine = new Set(ln.stations);
            const addable = Object.values(stations)
              .filter((st) => !onLine.has(st.id))
              .map((st) => (
                <StationView
                  key={'add-l:' + st.id}
                  station={st}
                  lines={lines}
                  zoom={zoom}
                  onStartDrag={onStartDrag}
                  layer="highlight-label"
                  highlightColor="#bbb"
                />
              ));

            const idx = append.insertAfterIndex ?? -1;
            const stopWorld = (sid: string) => {
              const st = stations[sid];
              if (!st) return null;
              const cell = st.stops.find((c) => c.lineId === highlightLineId);
              if (!cell) return null;
              return stopPosWorld(cell, st);
            };

            // Pick origin (the stop the arrow extends from) and the
            // direction in which insertion will happen.
            let originIdx: number;
            let dirToIdx: number | null;
            let dirSign: 1 | -1 = 1;
            if (idx === -1) {
              // Insert at start: arrow extends BEFORE station 0,
              // opposite of the 0→1 direction.
              originIdx = 0;
              dirToIdx = ln.stations.length > 1 ? 1 : null;
              dirSign = -1;
            } else if (idx >= ln.stations.length - 1) {
              // After last station: arrow extends past it in the
              // direction of the final segment.
              originIdx = idx;
              dirToIdx = idx > 0 ? idx - 1 : null;
              dirSign = -1;
            } else {
              // Between K and K+1: arrow points from K toward K+1.
              originIdx = idx;
              dirToIdx = idx + 1;
              dirSign = 1;
            }

            const originSid = ln.stations[originIdx];
            const origin = originSid ? stopWorld(originSid) : null;
            const dirRef = dirToIdx != null ? stopWorld(ln.stations[dirToIdx]) : null;
            let arrow: ReactNode = null;
            if (origin && dirRef) {
              const rdx = (dirRef.x - origin.x) * dirSign;
              const rdy = (dirRef.y - origin.y) * dirSign;
              const rlen = Math.hypot(rdx, rdy) || 1;
              const dx = rdx / rlen;
              const dy = rdy / rlen;
              // Triangle: base STOP_SIZE wide centered just past the
              // dot, apex one stop further along the direction. For
              // the -1 ("add before start") case the arrow is rendered
              // outside station 0, but flipped 180° so it points back
              // down the line at station 0.
              const baseDist = STOP_SIZE * 0.85;
              const apexDist = baseDist + STOP_SIZE * 0.7;
              const halfW = STOP_SIZE * 0.55;
              const flipped = idx === -1;
              const baseR = flipped ? apexDist : baseDist;
              const apexR = flipped ? baseDist : apexDist;
              arrow = (
                <path
                  d={arrowTrianglePath(origin.x, origin.y, dx, dy, baseR, apexR, halfW)}
                  fill={ln.color}
                  stroke={legibleTextOn(ln.color)}
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              );
            }

            const starterSid = idx >= 0 ? ln.stations[idx] : null;
            const starter =
              starterSid && stations[starterSid] ? (
                <StationView
                  key={'starter:' + starterSid}
                  station={stations[starterSid]}
                  lines={lines}
                  zoom={zoom}
                  onStartDrag={onStartDrag}
                  layer="starter-label"
                  highlightColor={ln.color}
                />
              ) : null;

            return (
              <>
                {addable}
                {arrow}
                {starter}
              </>
            );
          })()}
      </g>
    </>
  );
}
