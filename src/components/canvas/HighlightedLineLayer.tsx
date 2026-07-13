import { Fragment, type ComponentProps, type ReactNode } from 'react';
import type { Line, LineId, Station, StationId } from '../../model/types';
import type { UiMode } from '../../state/selection';
import {
  resolveSegmentStyle,
  stopPosWorld,
  type OrderedRenderable,
} from '../../geometry/interlining';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotStyle } from '../../model/transforms';
import { STOP_SIZE } from '../../geometry/orientation';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';
import { lineStrokeColorOf, lineStrokeRailWidth, lineStrokeWidthOf } from '../../model/lineStroke';
import { CasingRails } from '../CasingRails';
import { dotSizeOverride } from '../../model/dotSize';
import { StopMarker } from '../StopMarker';
import { StopGlyph } from '../StopGlyph';
import { StationView } from '../StationView';
import { legibleTextOn } from '../../util/color';
import { useThemeColors } from '../../state/theme';

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

// The selected-line highlight: a dim wash over the whole map plus the chosen
// line re-painted on top (stripes, stop markers, stop dots, names), with
// append-mode affordances when adding stations. Dim strength comes from
// the theme — softer in light mode so the rest of the map stays readable as
// context.
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
  const themeColors = useThemeColors();
  return (
    <>
      {themeColors.dimOpacity > 0 && (
        <rect
          data-dim="1"
          x={vbX}
          y={vbY}
          width={vbW}
          height={vbH}
          fill={themeColors.dim}
          fillOpacity={themeColors.dimOpacity}
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
          // Two buckets so dimmed stripe + colored stop square + stop dot
          // at one station composite *together* into one isolated group
          // (children overdraw normally, then the group composites once at
          // 0.2). Without this each dimmed element composites to the
          // background separately and you see the stripe tinting through the
          // marker, the marker tinting through the dot, etc. When no divider
          // is hovered, everything goes into the matched bucket and renders
          // flat.
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
            const stripeW = r.band.stripeWidths[r.stripeIndex];
            const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
              style,
              ln.color,
              stripeW,
            );
            const underlay = lineStyleUnderlayAttrs(style, underlayColor);
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
                {/* Casing rails centered on the body edges — see CasingRails. */}
                <CasingRails
                  centerline={r.band.centerline}
                  radius={r.band.radius}
                  offset={r.band.stripeOffsets[r.stripeIndex]}
                  bodyWidth={stripeW}
                  railW={railW}
                  color={lineStrokeColorOf(ln)}
                />
              </Fragment>,
            );
          });
          renderables.forEach((r, i) => {
            if (r.kind !== 'marker' || r.spec.lineId !== highlightLineId) return;
            push(
              isHoverStation(r.spec.stationId),
              <StopMarker
                key={'hl-m:' + i}
                spec={r.spec}
                underlayColor={underlayColor}
                lines={lines}
              />,
            );
          });
          // Re-render the selected line's stop dots on top so the colored
          // markers don't swallow them.
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
                style={resolveDotStyle(ln, cell)}
                lineColor={ln.color}
                serviceCode={ln.service}
                sizeOverride={dotSizeOverride(ln, cell)}
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
                  highlightColor={themeColors.dimmedLabel}
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
