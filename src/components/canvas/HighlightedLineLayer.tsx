import { type ComponentProps, type ReactNode } from 'react';
import type { Line, LineId, SeamEdges, Station, StationId } from '../../model/types';
import type { UiMode } from '../../state/selection';
import { stopPosWorld, type OrderedRenderable } from '../../geometry/interlining';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotStyle, stationIsSingleton } from '../../model/transforms';
import { STOP_SIZE } from '../../geometry/orientation';
import { SegmentBand } from '../SegmentBand';
import { dotSizeOverride } from '../../model/dotSize';
import { StopMarker } from '../StopMarker';
import { StopGlyph } from '../StopGlyph';
import { DashGlyph } from '../DashGlyph';
import { dashSpec } from '../../geometry/stationDash';
import { StationView } from '../StationView';
import { StationSilhouette } from '../StationSilhouette';
import { useThemeColors } from '../../state/theme';
import {
  appendSegmentHoverPreview,
  appendStationHoverPreview,
  validCursor,
  type AppendHover,
} from './appendGestures';
import { offsetFilletPath } from '../../geometry/router';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';

interface Props {
  highlightLineId: LineId;
  lines: Record<LineId, Line>;
  stations: Record<StationId, Station>;
  renderables: OrderedRenderable[];
  underlayColor: string;
  // Global branch-seam inner-edge mode, forwarded to the overlay's seam bands
  // so the highlighted line's seam matches the main layer.
  seamEdges: SeamEdges;
  uiMode: UiMode;
  // Edit Stops mouseover target (already pan-suppressed by the caller — null
  // while panning). Drives the 50%-opacity preview of the ring/halo a click
  // would produce: a station ring on a hovered station, a halo on a hovered
  // segment. Gated per target through the click matrix (appendGestures) so the
  // preview never promises an action the click wouldn't take.
  appendHover?: AppendHover;
  zoom: number;
  onStartDrag: ComponentProps<typeof StationView>['onStartDrag'];
  // Edit Stops: the clickable × chips next to the cursor station / on the
  // armed segment remove them (the chips render OUTSIDE the
  // pointer-events:none wash).
  onRemoveCursorStation?: (stationId: StationId) => void;
  onRemoveCursorEdge?: (from: StationId, to: StationId) => void;
  // Edit Stops: cycles the armed segment's line style (solid → dashed →
  // hatched → …). Renders a second chip beside the × on the armed segment,
  // outside the wash like the × chip; a visible alternative to shift-click.
  onCycleCursorEdgeStyle?: (from: StationId, to: StationId) => void;
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
  seamEdges,
  uiMode,
  appendHover,
  zoom,
  onStartDrag,
  onRemoveCursorStation,
  onRemoveCursorEdge,
  onCycleCursorEdgeStyle,
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
          // Edit Stops cursor (validated: a stale cursor renders nothing).
          const append =
            uiMode.kind === 'appending-to-line' && uiMode.lineId === highlightLineId
              ? uiMode
              : null;
          const cursor = append ? validCursor(ln, append.cursor) : null;
          const armedPairKey = cursor?.kind === 'edge' ? pairKeyOf(cursor.from, cursor.to) : null;
          const parts: ReactNode[] = [];
          const push = (node: ReactNode) => parts.push(node);
          // Repaint the selected line's bands with the SAME three-pass renderer
          // the main layer uses (SegmentBand), rendered `decorative` so the
          // overlay copies carry no DOM identity tags (see SegmentBand). Each
          // pass is its OWN sweep — every silhouette, then every body, then
          // every seam — so the line's own overlapping bands (loops/branches)
          // merge into one outer casing / one seam instead of a later stripe
          // overdrawing an earlier one. Color, per-segment style, casing, and
          // seam are all resolved live inside SegmentBand from the `lines` map.
          const stripesOfLine = renderables.filter(
            (r): r is Extract<OrderedRenderable, { kind: 'stripe' }> =>
              r.kind === 'stripe' && r.band.lines[r.stripeIndex].id === highlightLineId,
          );
          const pushBand = (pass: 'silhouette' | 'body' | 'seam', keyPrefix: string) =>
            stripesOfLine.forEach((r, i) =>
              push(
                <SegmentBand
                  key={keyPrefix + i}
                  decorative
                  spec={r.band}
                  stripeIndex={r.stripeIndex}
                  pass={pass}
                  lines={lines}
                  underlayColor={underlayColor}
                  seamEdges={seamEdges}
                />,
              ),
            );
          pushBand('silhouette', 'hl-sil:');
          pushBand('body', 'hl-b:');
          pushBand('seam', 'hl-seam:');
          // A two-tone halo (black edge / white core, the selection-ring
          // convention) around a corridor's stripes. The ARMED edge cursor
          // repaints the body on top at full strength (a brightness bump alone
          // got lost); the HOVER preview drops the body and rides at 50%, so a
          // faint copy reads as "click to arm this" — mirroring the main
          // canvas's 50%-opacity mouseover chrome.
          const haloForPairKey = (
            pairKey: string,
            opts: { key: string; dataAttr: string; withBody: boolean; opacity?: number },
          ): ReactNode => {
            const stripes = stripesOfLine.filter((r) => r.band.pairKey === pairKey);
            if (stripes.length === 0) return null;
            return (
              <g key={opts.key} {...{ [opts.dataAttr]: pairKey }} opacity={opts.opacity}>
                {stripes.map((r, i) => {
                  const d = offsetFilletPath(
                    r.band.centerline,
                    r.band.radius,
                    r.band.stripeOffsets[r.stripeIndex],
                  );
                  const w = r.band.stripeWidths[r.stripeIndex];
                  return (
                    <g key={opts.key + ':' + i}>
                      <path
                        d={d}
                        fill="none"
                        stroke="#000"
                        strokeWidth={w + 10}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={w + 6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {opts.withBody && (
                        <SegmentBand
                          decorative
                          spec={r.band}
                          stripeIndex={r.stripeIndex}
                          pass="body"
                          lines={lines}
                          underlayColor={underlayColor}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          };
          // Hover-preview halo on the segment under the cursor (suppressed on
          // the armed edge itself — appendSegmentHoverPreview handles that).
          const hoverSegKey =
            append &&
            appendHover?.kind === 'segment' &&
            appendSegmentHoverPreview(ln, append.cursor, appendHover.pairKey)
              ? appendHover.pairKey
              : null;
          if (armedPairKey)
            push(
              haloForPairKey(armedPairKey, {
                key: 'armed-seg',
                dataAttr: 'data-armed-segment',
                withBody: true,
              }),
            );
          if (hoverSegKey)
            push(
              haloForPairKey(hoverSegKey, {
                key: 'hover-seg',
                dataAttr: 'data-append-hover-segment',
                withBody: false,
                opacity: 0.5,
              }),
            );
          // Gentle whole-line preview of a hovered FOREIGN line: repaint its
          // stripes above the dim at partial strength — the line "lights up"
          // to say a click here switches the editor to it. Decorative bodies
          // only (no casing halo): a soft cue, not the selection treatment.
          if (append && appendHover?.kind === 'line' && lines[appendHover.lineId]) {
            const foreignId = appendHover.lineId;
            const foreignStripes = renderables.filter(
              (r): r is Extract<OrderedRenderable, { kind: 'stripe' }> =>
                r.kind === 'stripe' && r.band.lines[r.stripeIndex].id === foreignId,
            );
            if (foreignStripes.length > 0)
              push(
                <g key="hover-line" data-append-hover-line={foreignId} opacity={0.55}>
                  {foreignStripes.map((r, i) => (
                    <SegmentBand
                      key={'hover-line:' + i}
                      decorative
                      spec={r.band}
                      stripeIndex={r.stripeIndex}
                      pass="body"
                      lines={lines}
                      underlayColor={underlayColor}
                    />
                  ))}
                </g>,
              );
          }
          renderables.forEach((r, i) => {
            if (r.kind !== 'marker' || r.spec.lineId !== highlightLineId) return;
            push(
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
            const isSingleton = stationIsSingleton(st);
            const style = resolveDotStyle(ln, cell, isSingleton);
            if (style.shape === 'dash') {
              // Dash stops re-render as ticks, same as the base dots pass.
              push(
                <DashGlyph
                  key={'hl-d:' + sid}
                  spec={dashSpec(st, cell, ln)}
                  style={style}
                  lineColor={ln.color}
                  line={ln}
                  stationId={sid}
                  lineId={cell.lineId}
                />,
              );
              continue;
            }
            const { x: cx, y: cy } = stopPosWorld(cell, st);
            push(
              <StopGlyph
                key={'hl-d:' + sid}
                cx={cx}
                cy={cy}
                style={style}
                lineColor={ln.color}
                serviceCode={ln.service}
                sizeOverride={dotSizeOverride(ln, cell, isSingleton)}
                stationId={sid}
                lineId={cell.lineId}
              />,
            );
          }
          // Selected line's station names rendered in white above dim.
          // The cursor station gets its own treatment below (line-color
          // name + ring), so skip it here.
          const cursorStationId = cursor?.kind === 'station' ? cursor.stationId : null;
          for (const sid of ln.stations) {
            if (sid === cursorStationId) continue;
            const st = stations[sid];
            if (!st) continue;
            push(
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
          return <>{parts}</>;
        })()}
        {/* In Edit Stops, surface stations not yet on the line as light gray
            labels above the dim, and mark the cursor: a two-tone ring + line-
            color name on a station cursor (the armed edge repaints brighter in
            the band sweep above). */}
        {uiMode.kind === 'appending-to-line' &&
          uiMode.lineId === highlightLineId &&
          (() => {
            const ln = lines[highlightLineId];
            if (!ln) return null;
            // A two-tone ring (white core / black edge, the same selection-ring
            // convention as the segment halo) around a stop. One helper for both
            // the ARMED station cursor (full strength) and its HOVER preview
            // (an identical copy at 50%) so the two can never diverge. Non-
            // scaling strokes keep it crisp at any zoom; it reads on any color.
            const twoToneRing = (
              x: number,
              y: number,
              opts: { dataAttr: string; id: string; opacity?: number },
            ): ReactNode => (
              <g {...{ [opts.dataAttr]: opts.id }} opacity={opts.opacity}>
                <circle
                  cx={x}
                  cy={y}
                  r={STOP_SIZE * 0.75}
                  fill="none"
                  stroke="#000"
                  strokeWidth={5}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={STOP_SIZE * 0.75}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
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

            const cursor = validCursor(ln, uiMode.cursor);
            let ring: ReactNode = null;
            let starter: ReactNode = null;
            if (cursor?.kind === 'station' && stations[cursor.stationId]) {
              const st = stations[cursor.stationId];
              const cell = st.stops.find((c) => c.lineId === highlightLineId);
              if (cell) {
                const p = stopPosWorld(cell, st);
                ring = twoToneRing(p.x, p.y, {
                  dataAttr: 'data-append-cursor',
                  id: cursor.stationId,
                });
              }
              starter = (
                <StationView
                  key={'starter:' + cursor.stationId}
                  station={st}
                  lines={lines}
                  zoom={zoom}
                  onStartDrag={onStartDrag}
                  layer="starter-label"
                  highlightColor={ln.color}
                />
              );
            }

            // Hover-preview ring on the station under the cursor: a 50% copy of
            // the same two-tone ring, at the stop (a member) or the anchor (a
            // not-yet-added station a click would seed/connect/splice). Gated by
            // the click matrix so it never rings a station a click wouldn't act
            // on, and suppressed on the armed station cursor (which wears the
            // full ring above).
            // The dashed hover-zone boundary on the station under the pointer:
            // its true clickable footprint (cells ∪ label rect), shown for
            // EVERY station, member or not — "you are over this station, here
            // is its edge". Independent of the ring preview below, which only
            // promises an actionable click.
            const hoverZone: ReactNode =
              appendHover?.kind === 'station' && stations[appendHover.stationId] ? (
                <StationSilhouette
                  station={stations[appendHover.stationId]}
                  layer="hover-zone"
                />
              ) : null;

            let hoverRing: ReactNode = null;
            if (
              appendHover?.kind === 'station' &&
              appendStationHoverPreview(ln, uiMode.cursor, appendHover.stationId)
            ) {
              const st = stations[appendHover.stationId];
              if (st) {
                const cell = st.stops.find((c) => c.lineId === highlightLineId);
                const p = cell ? stopPosWorld(cell, st) : { x: st.x, y: st.y };
                hoverRing = twoToneRing(p.x, p.y, {
                  dataAttr: 'data-append-hover-ring',
                  id: appendHover.stationId,
                  opacity: 0.5,
                });
              }
            }

            return (
              <>
                {addable}
                {hoverZone}
                {ring}
                {starter}
                {hoverRing}
              </>
            );
          })()}
      </g>
      {/* The × chip beside whatever the cursor has armed (a stop, or the
          middle of the armed segment) — removes it. Clickable, so it lives
          OUTSIDE the pointer-events:none wash. Sized in screen space via the
          committed zoom, like the rest of the edit chrome. */}
      {uiMode.kind === 'appending-to-line' &&
        uiMode.lineId === highlightLineId &&
        (() => {
          const ln = lines[highlightLineId];
          if (!ln) return null;
          const cursor = validCursor(ln, uiMode.cursor);
          if (cursor?.kind === 'station' && onRemoveCursorStation) {
            const st = stations[cursor.stationId];
            const cell = st?.stops.find((c) => c.lineId === highlightLineId);
            if (!st || !cell) return null;
            const p = stopPosWorld(cell, st);
            return (
              <g
                data-append-remove-stop={cursor.stationId}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCursorStation(cursor.stationId);
                }}
              >
                <title>Remove this stop from the line</title>
                <RemoveChipGlyph cx={p.x + 16 / zoom} cy={p.y - 16 / zoom} zoom={zoom} />
              </g>
            );
          }
          if (cursor?.kind === 'edge' && (onRemoveCursorEdge || onCycleCursorEdgeStyle)) {
            // Anchor the chips just above the armed corridor's midpoint. The
            // style-cycle chip and the × chip flank the midpoint symmetrically.
            const pairKey = pairKeyOf(cursor.from, cursor.to);
            const r = renderables.find(
              (x): x is Extract<OrderedRenderable, { kind: 'stripe' }> =>
                x.kind === 'stripe' &&
                x.band.pairKey === pairKey &&
                x.band.lines[x.stripeIndex].id === highlightLineId,
            );
            if (!r) return null;
            const mid = sampleOffsetPath(
              r.band.centerline,
              r.band.radius,
              r.band.stripeOffsets[r.stripeIndex],
              0.5,
            ).p;
            const { from, to } = cursor;
            const chipY = mid.y - 16 / zoom;
            return (
              <>
                {onCycleCursorEdgeStyle && (
                  <g
                    data-append-cycle-segment-style={pairKey}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCycleCursorEdgeStyle(from, to);
                    }}
                  >
                    <title>Cycle this segment&rsquo;s line style</title>
                    <StyleChipGlyph cx={mid.x - 13 / zoom} cy={chipY} zoom={zoom} />
                  </g>
                )}
                {onRemoveCursorEdge && (
                  <g
                    data-append-remove-segment={pairKey}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCursorEdge(from, to);
                    }}
                  >
                    <title>Remove this segment</title>
                    <RemoveChipGlyph cx={mid.x + 13 / zoom} cy={chipY} zoom={zoom} />
                  </g>
                )}
              </>
            );
          }
          return null;
        })()}
    </>
  );
}

// Invisible click pad under a chip glyph: the painted disc is only 16px
// across and floats over live targets (the station / the stripe), so a
// near-miss used to land beneath it and MUTATE the line (connect/splice/arm)
// instead of hitting the chip. transparent fill still captures pointer events.
function ChipHitPad({ cx, cy, zoom }: { cx: number; cy: number; zoom: number }) {
  return <circle data-chip-hit-pad="1" cx={cx} cy={cy} r={14 / zoom} fill="transparent" />;
}

// The shared × glyph for the remove chips: a white disc with a black cross,
// sized in screen space so it stays clickable at any zoom.
function RemoveChipGlyph({ cx, cy, zoom }: { cx: number; cy: number; zoom: number }) {
  const r = 8 / zoom;
  const arm = r * 0.45;
  return (
    <>
      <ChipHitPad cx={cx} cy={cy} zoom={zoom} />
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#000" strokeWidth={1 / zoom} />
      <path
        d={`M ${cx - arm} ${cy - arm} L ${cx + arm} ${cy + arm} M ${cx - arm} ${cy + arm} L ${cx + arm} ${cy - arm}`}
        stroke="#000"
        strokeWidth={1.5 / zoom}
        strokeLinecap="round"
      />
    </>
  );
}

// The glyph for the style-cycle chip: a white disc with a short black dashed
// line — a direct picture of "line style" (the segment's dash pattern). Sized
// in screen space like RemoveChipGlyph so it stays legible/clickable at any zoom.
function StyleChipGlyph({ cx, cy, zoom }: { cx: number; cy: number; zoom: number }) {
  const r = 8 / zoom;
  const half = r * 0.6;
  const dash = 2.2 / zoom;
  return (
    <>
      <ChipHitPad cx={cx} cy={cy} zoom={zoom} />
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#000" strokeWidth={1 / zoom} />
      <line
        x1={cx - half}
        y1={cy}
        x2={cx + half}
        y2={cy}
        stroke="#000"
        strokeWidth={1.6 / zoom}
        strokeDasharray={`${dash} ${dash * 0.8}`}
      />
    </>
  );
}
