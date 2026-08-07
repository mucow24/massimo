import { Line, Station } from '../model/types';
import { useSelection } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { STOP_DOT_RADIUS, stationFrameDeg, stopCenterAt } from '../geometry/orientation';
import { stationCircle } from '../geometry/lineCircle';
import { stopPosWorld } from '../geometry/interlining';
import { resolveDotStyle, stationIsSingleton } from '../model/transforms';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import { dotSizeOverride } from '../model/dotSize';
import { StopGlyph } from './StopGlyph';
import { DashGlyph } from './DashGlyph';
import { dashSpec } from '../geometry/stationDash';
import { useStationInteraction } from './useStationInteraction';

// The dot a waypoint shows under the Show-waypoints overlay: a black-stroke /
// white-fill circle. Applied as a render-time OVERRIDE (never written to the
// stop) so the per-stop dotStyle survives untouched when the overlay is off —
// mirroring the non-destructive spirit of the `isWaypoint` flag itself.
const WAYPOINT_OVERLAY_STYLE = DOT_SHAPE_PRESETS['filled-white-black-stroke'];

// Empty stations get a single phantom dot one cell to the right of the label,
// so there's something visible and the name has an anchor. A hidden waypoint
// never shows one (the whole point is "no visible station"); a revealed one
// behaves like a regular empty station.
function phantomDotCell(station: Station, showWaypoints: boolean) {
  const hidden = !!station.isWaypoint && !showWaypoints;
  return !hidden && station.stops.length === 0
    ? { row: station.label.row, col: station.label.col + 1 }
    : null;
}

// Which slice of the dot stack one mount paints. `undefined` = all three, in
// order, from a single mount — what an isolated caller (the layout editor's
// lifted station) wants. MapCanvas asks for them one at a time instead, so it
// can slot the lifted transfer passes into the gaps (see TransferDrawOrder).
export type DotSubPass = 'silhouettes' | 'bodies' | 'codes';

// The two SHAPE sub-passes and the StopGlyph pass each names. 'codes' is
// absent from both on purpose — it renders from StationDotCodes, never from
// the shape loop, which is why StationDotShapes' `sub` excludes it outright.
const SHAPE_PASSES = ['stroke', 'fill'] as const;
const SHAPE_PASS_OF = { silhouettes: 'stroke', bodies: 'fill' } as const;

/**
 * A station's stop dots (the 'dots' pass), in three z-ordered sub-passes:
 *
 *   1. silhouettes — the TfL ticks, then every dot's stroke silhouette
 *   2. bodies      — every dot's fill (and the empty-station phantom preview)
 *   3. codes       — every service code
 *
 * Passes 1 and 2 are the stroke-before-fill motif: overlapping dots in one
 * station share a single continuous outer border, because every silhouette is
 * painted before every body. Pass 3 exists for the same reason one rung up —
 * a neighbour's body must not land on a dot's service code.
 *
 * Paints above the DEFAULT transfer rung, so an ordinary transfer never
 * obscures the dot it connects; a transfer only reaches higher by asking, via
 * its `draw` rung, and where one does it takes the dot's pixels — and its
 * clicks — with it (see TransferLayer). To hold dot-click-priority over
 * everything below, the wrapper itself is hit-testable: each visible dot
 * absorbs clicks per-pixel (default `visiblePainted`) and the click bubbles to
 * the wrapper, which forwards to the same station-onClick logic the bg layer
 * uses. `pointer-events: none` in tag-mode keeps band-stripe hover working when
 * the cursor passes over a dot.
 */
export function StationDots({
  station,
  lines,
  onStartDrag,
  sub,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  sub?: DotSubPass;
}) {
  // The codes pass carries no interaction at all — its only content is
  // pointer-events:none text — so it renders from its own component, which
  // skips useStationInteraction entirely. That hook subscribes to the WHOLE
  // selection store (no selector) and this pass runs once per station per
  // render, so paying for it to render nothing on every station without a
  // service code is the one cost the three-way split would otherwise add.
  if (sub === 'codes') return <StationDotCodes station={station} lines={lines} />;
  const shapes = (
    <StationDotShapes station={station} lines={lines} onStartDrag={onStartDrag} sub={sub} />
  );
  // Combined mount: all three in order, so its union IS the split's.
  if (sub !== undefined) return shapes;
  return (
    <>
      {shapes}
      <StationDotCodes station={station} lines={lines} />
    </>
  );
}

/**
 * The two SHAPE sub-passes — dot silhouettes and dot bodies (plus the ticks and
 * the phantom preview, which ride the one their z-order puts them in). This is
 * where the station's pointer surface lives; the codes pass has none.
 */
function StationDotShapes({
  station,
  lines,
  onStartDrag,
  sub,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  sub?: Exclude<DotSubPass, 'codes'>;
}) {
  const hoveredStop = useSelection((s) => s.hoveredLineStop);
  // Stop cells on a circle-bound station resolve through the RING frame, so the
  // dot lands on its own arc (see `stationFrameRad`). Reference-stable, so this
  // subscription only re-renders a station when the circles themselves change.
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const { handlers, cursor, hitless } = useStationInteraction(station, onStartDrag, lines);
  const themeColors = useThemeColors();
  const showWaypoints = useViewportStore((s) => s.showWaypoints);
  // A waypoint stays invisible unless the overlay is on; when it is, its stops
  // paint in the fixed black/white overlay style rather than their own.
  if (station.isWaypoint && !showWaypoints) return null;
  const wpOverride = station.isWaypoint ? WAYPOINT_OVERLAY_STYLE : null;
  // The phantom preview is a STOP, so its group turns with the stop frame —
  // on a ring-bound station that is the ring's, not the octant (stationFrameRad).
  const circle = stationCircle(station, lineCircles);
  const angle = stationFrameDeg(station, circle);
  // Singleton vs. shared drives which split default each stop resolves — a
  // per-station property (every stop here shares it), recomputed each render so
  // a station reduced to one line immediately adopts its singleton default.
  const isSingleton = stationIsSingleton(station);
  const phantomDot = phantomDotCell(station, showWaypoints);
  const resolvedStops = station.stops.map((cell) => ({
    cell,
    style: wpOverride ?? resolveDotStyle(lines[cell.lineId], cell, isSingleton),
  }));
  // Which glyph passes this mount emits, in paint order — the codes pass is
  // not among them (it renders from StationDotCodes). The ticks and the
  // phantom preview ride the sub-pass their z-order already put them in.
  const glyphPasses = sub === undefined ? SHAPE_PASSES : [SHAPE_PASS_OF[sub]];
  const wantsTicks = sub === undefined || sub === 'silhouettes';
  const wantsPhantom = sub === undefined || sub === 'bodies';
  // Dash (TfL tick) stops split off from the dot passes: each renders one
  // DashGlyph beneath every dot, painted far-from-label first so the tick
  // NEAREST the label lands on top where overlapping ticks stack. (The
  // waypoint override is a circle, so a revealed waypoint never ticks.) Built
  // only for the pass that paints them — dashSpec is real geometry per tick,
  // and the bodies mount would throw every one of them away.
  const dashStops = !wantsTicks
    ? []
    : resolvedStops
        .filter((r) => r.style.shape === 'dash')
        .map((r) => ({ ...r, spec: dashSpec(station, r.cell, lines[r.cell.lineId], circle) }))
        .sort(
          (a, b) =>
            b.spec.labelDist - a.spec.labelDist || a.cell.lineId.localeCompare(b.cell.lineId),
        );
  const dotStops = resolvedStops.filter((r) => r.style.shape !== 'dash');
  return (
    <g
      pointerEvents={hitless ? 'none' : undefined}
      style={{ cursor }}
      // Show-waypoints is a view aid, never a formal map edit: a revealed
      // waypoint's overlay dots (and any phantom drag preview) must be stripped
      // from every export, so tag the whole group for the export strip.
      data-export-exclude={station.isWaypoint ? '1' : undefined}
      {...handlers}
    >
      {/* Phantom dot is a drag preview — render at cell position, in the
          station's local frame. A body, not a silhouette: it is the whole
          glyph of a station that has no real dot. */}
      {wantsPhantom && phantomDot && (
        <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
          {(() => {
            const c = stopCenterAt(phantomDot.row, phantomDot.col);
            return <circle cx={c.x} cy={c.y} r={STOP_DOT_RADIUS} fill={themeColors.phantomDot} />;
          })()}
        </g>
      )}
      {/* Ticks first: real map paint, but always beneath the circular dots so
          an interchange dot on a crossed stripe stays on top of a tick. They
          ride the silhouette sub-pass — the bottom of the dot stack — rather
          than splitting their own casing out, which would put a tick's body
          above a neighbouring dot's border. */}
      {wantsTicks &&
        dashStops.map(({ cell, style, spec }) => (
          <DashGlyph
            key={'dash:' + cell.lineId}
            spec={spec}
            style={style}
            lineColor={lines[cell.lineId]?.color}
            line={lines[cell.lineId]}
            isHovered={hoveredStop?.stationId === station.id && hoveredStop?.lineId === cell.lineId}
            stationId={station.id}
            lineId={cell.lineId}
          />
        ))}
      {glyphPasses.map((pass) =>
        dotStops.map(({ cell, style }) => {
          const w = stopPosWorld(cell, station, lineCircles);
          const isHovered =
            hoveredStop?.stationId === station.id && hoveredStop?.lineId === cell.lineId;
          return (
            <StopGlyph
              key={pass + ':' + cell.lineId}
              pass={pass}
              cx={w.x}
              cy={w.y}
              style={style}
              lineColor={lines[cell.lineId]?.color}
              serviceCode={lines[cell.lineId]?.service}
              sizeOverride={dotSizeOverride(lines[cell.lineId], cell, isSingleton)}
              isHovered={isHovered}
              stationId={station.id}
              lineId={cell.lineId}
            />
          );
        }),
      )}
    </g>
  );
}

/**
 * The service-code sub-pass: every code in this station, above every dot body
 * so no neighbouring dot can clip one. Deliberately NOT interactive — the text
 * is `pointer-events: none`, so this skips `useStationInteraction` (a
 * selectorless whole-store subscription) and the wrapper's handlers entirely.
 *
 * Returns null when no stop resolves a code, which is most stations on most
 * maps: this pass runs once per station per render, so the early-out is what
 * keeps the third mount from costing anything where it draws nothing.
 */
function StationDotCodes({ station, lines }: { station: Station; lines: Record<string, Line> }) {
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const showWaypoints = useViewportStore((s) => s.showWaypoints);
  if (station.isWaypoint && !showWaypoints) return null;
  // The waypoint overlay style shows no code, so a revealed waypoint resolves
  // an empty list here and drops out at the guard below.
  const wpOverride = station.isWaypoint ? WAYPOINT_OVERLAY_STYLE : null;
  const isSingleton = stationIsSingleton(station);
  const coded = station.stops
    .map((cell) => ({
      cell,
      style: wpOverride ?? resolveDotStyle(lines[cell.lineId], cell, isSingleton),
    }))
    .filter((r) => r.style.showServiceCode && r.style.shape !== 'dash');
  if (coded.length === 0) return null;
  return (
    // Same export contract as the shape passes: a revealed waypoint's overlay
    // paint is a view aid, never map ink.
    <g data-export-exclude={station.isWaypoint ? '1' : undefined}>
      {coded.map(({ cell, style }) => {
        const w = stopPosWorld(cell, station, lineCircles);
        return (
          <StopGlyph
            key={'code:' + cell.lineId}
            pass="code"
            cx={w.x}
            cy={w.y}
            style={style}
            lineColor={lines[cell.lineId]?.color}
            serviceCode={lines[cell.lineId]?.service}
            sizeOverride={dotSizeOverride(lines[cell.lineId], cell, isSingleton)}
            stationId={station.id}
            lineId={cell.lineId}
          />
        );
      })}
    </g>
  );
}
