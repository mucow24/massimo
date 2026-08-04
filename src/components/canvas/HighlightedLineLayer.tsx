import { useMemo, type ComponentProps, type ReactNode } from 'react';
import type { Line, LineId, Station, StationId } from '../../model/types';
import type { UiMode } from '../../state/selection';
import {
  stopPosWorld,
  type OrderedRenderable,
  type SegmentBandSpec,
} from '../../geometry/interlining';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotStyle, spawnStopCellAt, stationIsSingleton } from '../../model/transforms';
import { stationCircle } from '../../geometry/lineCircle';
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
  appendRoutePreviewEdges,
  appendSegmentHoverPreview,
  appendSpawnSource,
  appendStationHoverPreview,
  validCursor,
  type AppendHover,
} from '../../model/appendGestures';
import { appendRoutePreviewStripes } from '../../geometry/appendRoutePreview';
import { offsetFilletPath } from '../../geometry/router';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';

// A hovered FOREIGN line's preview brightness. It lifts above the dim like the
// edited line — cased stripes plus its stop dots — but at HALF strength, so it
// reads as "click here to switch" and clearly stands out from the dimmed map,
// without competing with the fully-bright line being edited.
const HOVER_LINE_OPACITY = 0.5;

// The Edit Stops ROUTE preview's brightness — the corridors a click on the
// hovered second station would draw. Same half strength as the rest of the
// mode's mouseover chrome, which lands it exactly where it should read: above
// the dimmed map (which shows through at 1 − dimOpacity = 0.3) and below the
// fully-bright line being edited.
const ROUTE_PREVIEW_OPACITY = 0.5;

interface Props {
  highlightLineId: LineId;
  lines: Record<LineId, Line>;
  stations: Record<StationId, Station>;
  // Line circles, threaded to the route preview's band rebuild so a
  // prospective viaCircle edge previews as its real arc.
  lineCircles: Record<string, import('../../model/types').LineCircle>;
  renderables: OrderedRenderable[];
  underlayColor: string;
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
  lineCircles,
  renderables,
  underlayColor,
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
  const ln = lines[highlightLineId];
  // Edit Stops state for THIS line, derived once for all three blocks below
  // (the band/label repaint, the mode chrome, and the clickable chips) rather
  // than three times over. The cursor is validated: undo or a right-click
  // removal can strip its station/edge out from under the mode, and a stale
  // cursor renders no chrome anywhere.
  const append =
    uiMode.kind === 'appending-to-line' && uiMode.lineId === highlightLineId ? uiMode : null;
  const cursor = ln && append ? validCursor(ln, append.cursor) : null;
  // The station under the pointer that a click would ADD to the line: the
  // SECOND station of the connect/splice the first one (the pen, or the armed
  // segment's near end) started. One gate drives both cues below — the
  // line-colored name and the route preview — so they can never disagree about
  // what the click does.
  const secondStationId =
    append && appendHover?.kind === 'station' && ln
      ? appendRoutePreviewEdges(ln, append.cursor, appendHover.stationId).length > 0
        ? appendHover.stationId
        : null
      : null;
  // Rebuilding bands for the prospective route is one geometry pass, so key it
  // on the hover target — it only changes when the pointer crosses onto a
  // different station, while this layer re-renders on every viewport commit.
  const routePreview = useMemo(
    () =>
      secondStationId
        ? appendRoutePreviewStripes(
            stations,
            lines,
            highlightLineId,
            append?.cursor ?? null,
            secondStationId,
            lineCircles,
          )
        : [],
    [stations, lines, lineCircles, highlightLineId, append, secondStationId],
  );
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
          if (!ln) return null;
          const armedPairKey = cursor?.kind === 'edge' ? pairKeyOf(cursor.from, cursor.to) : null;
          const parts: ReactNode[] = [];
          const push = (node: ReactNode) => parts.push(node);
          // Repaint a line's bands with the SAME two-pass renderer the main
          // layer uses (SegmentBand), rendered `decorative` so the overlay
          // copies carry no DOM identity tags (see SegmentBand). Each pass is
          // its OWN sweep — every silhouette, then every body — so a line's
          // own overlapping bands (loops/branches) merge into one outer
          // casing instead of a later stripe overdrawing an earlier one.
          // Color, per-segment style, and casing are all resolved live inside
          // SegmentBand from the `lines` map. Shared by the edited line and a
          // hovered foreign line, so both "light up" above the dim
          // identically — bright and cased, not a faint casing-less overlay.
          const stripesOf = (lineId: string) =>
            renderables.filter(
              (r): r is Extract<OrderedRenderable, { kind: 'stripe' }> =>
                r.kind === 'stripe' && r.band.lines[r.stripeIndex].id === lineId,
            );
          const lineRepaintNodes = (
            stripes: { band: SegmentBandSpec; stripeIndex: number }[],
            keyPrefix: string,
          ): ReactNode[] =>
            (['silhouette', 'body'] as const).flatMap((pass) =>
              stripes.map((r, i) => (
                <SegmentBand
                  key={`${keyPrefix}:${pass}:${i}`}
                  decorative
                  spec={r.band}
                  stripeIndex={r.stripeIndex}
                  pass={pass}
                  lines={lines}
                  underlayColor={underlayColor}
                />
              )),
            );
          // A line's stop markers (from the band pipeline) then its stop dots on
          // top, so the colored markers don't swallow the dots. Dash stops render
          // as their travel-axis ticks, same as the base dots pass. Shared by the
          // edited line and a hovered foreign line so both carry their stops.
          const lineMarkerAndDotNodes = (line: Line, keyPrefix: string): ReactNode[] => {
            const nodes: ReactNode[] = [];
            renderables.forEach((r, i) => {
              if (r.kind !== 'marker' || r.spec.lineId !== line.id) return;
              nodes.push(
                <StopMarker
                  key={`${keyPrefix}-m:${i}`}
                  spec={r.spec}
                  underlayColor={underlayColor}
                  lines={lines}
                />,
              );
            });
            for (const sid of line.stations) {
              const st = stations[sid];
              if (!st) continue;
              const cell = st.stops.find((c) => c.lineId === line.id);
              if (!cell) continue;
              const isSingleton = stationIsSingleton(st);
              const style = resolveDotStyle(line, cell, isSingleton);
              if (style.shape === 'dash') {
                nodes.push(
                  <DashGlyph
                    key={`${keyPrefix}-d:${sid}`}
                    spec={dashSpec(st, cell, line, stationCircle(st, lineCircles))}
                    style={style}
                    lineColor={line.color}
                    line={line}
                    stationId={sid}
                    lineId={cell.lineId}
                  />,
                );
                continue;
              }
              const { x: cx, y: cy } = stopPosWorld(cell, st, lineCircles);
              nodes.push(
                <StopGlyph
                  key={`${keyPrefix}-d:${sid}`}
                  cx={cx}
                  cy={cy}
                  style={style}
                  lineColor={line.color}
                  serviceCode={line.service}
                  sizeOverride={dotSizeOverride(line, cell, isSingleton)}
                  stationId={sid}
                  lineId={cell.lineId}
                />,
              );
            }
            return nodes;
          };
          const stripesOfLine = stripesOf(highlightLineId);
          lineRepaintNodes(stripesOfLine, 'hl').forEach(push);
          // The ROUTE preview: the corridor(s) a click on the hovered second
          // station would draw — one for a connect, both halves for a splice.
          // Painted with the SAME renderer as the real line, so it carries the
          // line's own color, width, casing and fillets, at
          // ROUTE_PREVIEW_OPACITY. It sits under the halos, dots and names
          // pushed below, so no committed chrome is obscured by a maybe.
          if (routePreview.length > 0)
            push(
              <g
                key="route-preview"
                data-append-route-preview={secondStationId}
                opacity={ROUTE_PREVIEW_OPACITY}
              >
                {lineRepaintNodes(routePreview, 'route-preview')}
              </g>,
            );
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
          // Whole-line preview of a hovered FOREIGN line: repaint it above the dim
          // with the same renderer the edited line gets — cased stripes (three-
          // pass) PLUS its stop markers and dots — but at HALF strength
          // (HOVER_LINE_OPACITY), so it reads as "click here to switch" and stands
          // out from the dimmed map without competing with the fully-bright edited
          // line. (The old body-only, casing-less overlay let the dimmed original
          // bleed through a dashed body's gaps and dropped the dots entirely;
          // lifting the real line at half strength fixes both.)
          if (append && appendHover?.kind === 'line' && lines[appendHover.lineId]) {
            const foreignLine = lines[appendHover.lineId];
            const foreignStripes = stripesOf(foreignLine.id);
            if (foreignStripes.length > 0)
              push(
                <g
                  key="hover-line"
                  data-append-hover-line={foreignLine.id}
                  opacity={HOVER_LINE_OPACITY}
                >
                  {lineRepaintNodes(foreignStripes, 'hover-line')}
                  {lineMarkerAndDotNodes(foreignLine, 'hover-line')}
                </g>,
              );
          }
          // The selected line's stop markers + dots, repainted above the dim.
          lineMarkerAndDotNodes(ln, 'hl').forEach(push);
          // Selected line's station names rendered in white above dim.
          // The cursor station and the hovered second station both get the
          // line-color starter treatment below, so skip them here rather than
          // double-painting a white name under a colored one.
          const cursorStationId = cursor?.kind === 'station' ? cursor.stationId : null;
          for (const sid of ln.stations) {
            if (sid === cursorStationId || sid === secondStationId) continue;
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
        {append &&
          (() => {
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
              .filter((st) => !onLine.has(st.id) && st.id !== secondStationId)
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

            let ring: ReactNode = null;
            let starter: ReactNode = null;
            if (cursor?.kind === 'station' && stations[cursor.stationId]) {
              const st = stations[cursor.stationId];
              const cell = st.stops.find((c) => c.lineId === highlightLineId);
              if (cell) {
                const p = stopPosWorld(cell, st, lineCircles);
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

            // The hover-zone wash + ring on the station under the pointer: its
            // true clickable footprint (cells ∪ label rect), shown for EVERY
            // station, member or not — "you are over this station, here is its
            // edge". Painted the way the main map paints a station hover (see
            // StationSilhouette's hover-zone layer), and independent of the ring
            // preview below, which only promises an actionable click.
            const hoverZone: ReactNode =
              appendHover?.kind === 'station' && stations[appendHover.stationId] ? (
                <StationSilhouette station={stations[appendHover.stationId]} layer="hover-zone" />
              ) : null;

            // Hover-preview ring on the station under the cursor: a 50% copy of
            // the same two-tone ring, at the stop (a member) or where a click
            // would DROP the new stop on a non-member (spawnStopCellAt — the
            // exact cell seed/connect/splice will add). Ringing the station
            // anchor instead promised the wrong spot on an interchange, whose
            // anchor sits over an unrelated existing stop. Gated by the click
            // matrix so it never rings a station a click wouldn't act on, and
            // suppressed on the armed station cursor (which wears the full ring
            // above).
            let hoverRing: ReactNode = null;
            if (
              appendHover?.kind === 'station' &&
              appendStationHoverPreview(ln, append.cursor, appendHover.stationId)
            ) {
              const st = stations[appendHover.stationId];
              if (st) {
                // The same source station the click will wire from, so a ring
                // lane inherited on commit is the lane the ring promises.
                const srcId = appendSpawnSource(ln, append.cursor, appendHover.stationId);
                const cell =
                  st.stops.find((c) => c.lineId === highlightLineId) ??
                  spawnStopCellAt(
                    st,
                    highlightLineId,
                    lines,
                    lineCircles,
                    (srcId && stations[srcId]) || null,
                  );
                const p = stopPosWorld(cell, st, lineCircles);
                hoverRing = twoToneRing(p.x, p.y, {
                  dataAttr: 'data-append-hover-ring',
                  id: appendHover.stationId,
                  opacity: 0.5,
                });
              }
            }

            // The hovered SECOND station's name, promoted to the SAME
            // line-colored starter treatment the first station wears, so the
            // two ends of the pending click read as a pair. It replaces this
            // station's white/dimmed name (both passes above skip it) rather
            // than stacking a second label on top of it.
            const secondStarter: ReactNode =
              secondStationId && stations[secondStationId] ? (
                <g data-append-second-station={secondStationId}>
                  <StationView
                    station={stations[secondStationId]}
                    lines={lines}
                    zoom={zoom}
                    onStartDrag={onStartDrag}
                    layer="starter-label"
                    highlightColor={ln.color}
                  />
                </g>
              ) : null;

            return (
              <>
                {addable}
                {hoverZone}
                {ring}
                {starter}
                {secondStarter}
                {hoverRing}
              </>
            );
          })()}
      </g>
      {/* The × chip beside whatever the cursor has armed (a stop, or the
          middle of the armed segment) — removes it. Clickable, so it lives
          OUTSIDE the pointer-events:none wash. Sized in screen space via the
          committed zoom, like the rest of the edit chrome. */}
      {append &&
        (() => {
          if (!ln) return null;
          if (cursor?.kind === 'station' && onRemoveCursorStation) {
            const st = stations[cursor.stationId];
            const cell = st?.stops.find((c) => c.lineId === highlightLineId);
            if (!st || !cell) return null;
            const p = stopPosWorld(cell, st, lineCircles);
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
