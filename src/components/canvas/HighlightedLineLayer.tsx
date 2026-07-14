import { type ComponentProps, type ReactNode } from 'react';
import type { Line, LineId, Station, StationId } from '../../model/types';
import type { UiMode } from '../../state/selection';
import { stopPosWorld, type OrderedRenderable } from '../../geometry/interlining';
import { pairKeyOf } from '../../model/pairKey';
import { resolveDotStyle } from '../../model/transforms';
import { STOP_SIZE } from '../../geometry/orientation';
import { SegmentBand } from '../SegmentBand';
import { dotSizeOverride } from '../../model/dotSize';
import { StopMarker } from '../StopMarker';
import { StopGlyph } from '../StopGlyph';
import { StationView } from '../StationView';
import { useThemeColors } from '../../state/theme';
import { validCursor } from './appendGestures';
import { offsetFilletPath } from '../../geometry/router';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';

interface Props {
  highlightLineId: LineId;
  lines: Record<LineId, Line>;
  stations: Record<StationId, Station>;
  renderables: OrderedRenderable[];
  underlayColor: string;
  uiMode: UiMode;
  zoom: number;
  onStartDrag: ComponentProps<typeof StationView>['onStartDrag'];
  // Edit Stops: the clickable × chips next to the cursor station / on the
  // armed segment remove them (the chips render OUTSIDE the
  // pointer-events:none wash).
  onRemoveCursorStation?: (stationId: StationId) => void;
  onRemoveCursorEdge?: (from: StationId, to: StationId) => void;
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
  uiMode,
  zoom,
  onStartDrag,
  onRemoveCursorStation,
  onRemoveCursorEdge,
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
                />,
              ),
            );
          pushBand('silhouette', 'hl-sil:');
          pushBand('body', 'hl-b:');
          pushBand('seam', 'hl-seam:');
          // Armed edge cursor: a two-tone halo (black edge / white core, the
          // selection-ring convention) around the armed corridor's stripes,
          // then the body repainted on top — a brightness bump alone got lost.
          if (armedPairKey) {
            const armed = stripesOfLine.filter((r) => r.band.pairKey === armedPairKey);
            push(
              <g key="armed-seg" data-armed-segment={armedPairKey}>
                {armed.map((r, i) => {
                  const d = offsetFilletPath(
                    r.band.centerline,
                    r.band.radius,
                    r.band.stripeOffsets[r.stripeIndex],
                  );
                  const w = r.band.stripeWidths[r.stripeIndex];
                  return (
                    <g key={'armed:' + i}>
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
                      <SegmentBand
                        decorative
                        spec={r.band}
                        stripeIndex={r.stripeIndex}
                        pass="body"
                        lines={lines}
                        underlayColor={underlayColor}
                      />
                    </g>
                  );
                })}
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
            const { x: cx, y: cy } = stopPosWorld(cell, st);
            push(
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
                // Two-tone ring (white core / black edge) so it reads on any
                // line color; non-scaling strokes keep it crisp at any zoom.
                ring = (
                  <g data-append-cursor={cursor.stationId}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={STOP_SIZE * 0.75}
                      fill="none"
                      stroke="#000"
                      strokeWidth={5}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={STOP_SIZE * 0.75}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={3}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
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

            return (
              <>
                {addable}
                {ring}
                {starter}
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
          if (cursor?.kind === 'edge' && onRemoveCursorEdge) {
            // Anchor the chip just above the armed corridor's midpoint.
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
            return (
              <g
                data-append-remove-segment={pairKey}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCursorEdge(from, to);
                }}
              >
                <title>Remove this segment</title>
                <RemoveChipGlyph cx={mid.x + 16 / zoom} cy={mid.y - 16 / zoom} zoom={zoom} />
              </g>
            );
          }
          return null;
        })()}
    </>
  );
}

// The shared × glyph for the remove chips: a white disc with a black cross,
// sized in screen space so it stays clickable at any zoom.
function RemoveChipGlyph({ cx, cy, zoom }: { cx: number; cy: number; zoom: number }) {
  const r = 8 / zoom;
  const arm = r * 0.45;
  return (
    <>
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
