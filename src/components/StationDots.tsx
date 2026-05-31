import { Line, Station } from '../model/types';
import { useSelection } from '../state/store';
import { STOP_DOT_RADIUS, stopCenterAt } from '../geometry/orientation';
import { stopPosWorld } from '../geometry/interlining';
import { resolveDotShape } from '../model/transforms';
import { StopGlyph } from './StopGlyph';
import { useStationInteraction } from './useStationInteraction';

// Empty stations get a single phantom dot one cell to the right of the label,
// so there's something visible and the name has an anchor. Waypoints never
// show a phantom (the whole point is "no visible station").
function phantomDotCell(station: Station) {
  const isWp = !!station.isWaypoint;
  return !isWp && station.stops.length === 0
    ? { row: station.label.row, col: station.label.col + 1 }
    : null;
}

/**
 * A station's stop dots (the default 'dots' pass). Paints above transfers in
 * z-order so transfers never obscure the dots they connect. To preserve
 * dot-click-priority over transfers, the wrapper itself is hit-testable: each
 * visible dot absorbs clicks per-pixel (default `visiblePainted`) and the
 * click bubbles to the wrapper, which forwards to the same station-onClick
 * logic the bg layer uses. `pointer-events: none` in tag-mode keeps
 * band-stripe hover working when the cursor passes over a dot.
 */
export function StationDots({
  station,
  lines,
  onStartDrag,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
}) {
  const hoveredStop = useSelection((s) => s.hoveredLineStop);
  const { handlers, cursor, inHitlessMode } = useStationInteraction(station, onStartDrag, lines);
  if (station.isWaypoint) return null;
  const angle = station.rotation * 45;
  const phantomDot = phantomDotCell(station);
  return (
    <g pointerEvents={inHitlessMode ? 'none' : undefined} style={{ cursor }} {...handlers}>
      {/* Phantom dot is a drag preview — render at cell position, in the
          station's local frame. */}
      {phantomDot && (
        <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
          {(() => {
            const c = stopCenterAt(phantomDot.row, phantomDot.col);
            return <circle cx={c.x} cy={c.y} r={STOP_DOT_RADIUS} fill="#000" />;
          })()}
        </g>
      )}
      {station.stops.map((cell) => {
        const w = stopPosWorld(cell, station);
        const isHovered =
          hoveredStop?.stationId === station.id && hoveredStop?.lineId === cell.lineId;
        return (
          <StopGlyph
            key={cell.lineId}
            cx={w.x}
            cy={w.y}
            shape={resolveDotShape(lines[cell.lineId], cell)}
            isHovered={isHovered}
            stationId={station.id}
            lineId={cell.lineId}
          />
        );
      })}
    </g>
  );
}

/**
 * A station's dots in the highlight pass — plain filled circles in
 * `highlightColor`, no hit-testing, used for not-yet-on-line stations during
 * append mode so they stay visible above the dim overlay.
 */
export function StationHighlightDots({
  station,
  highlightColor,
}: {
  station: Station;
  highlightColor: string;
}) {
  if (station.isWaypoint) return null;
  const angle = station.rotation * 45;
  const phantomDot = phantomDotCell(station);
  return (
    <g pointerEvents="none">
      {/* Phantom dot is a drag preview — render at cell position, in the
          station's local frame. */}
      {phantomDot && (
        <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
          {(() => {
            const c = stopCenterAt(phantomDot.row, phantomDot.col);
            return <circle cx={c.x} cy={c.y} r={STOP_DOT_RADIUS} fill={highlightColor} />;
          })()}
        </g>
      )}
      {station.stops.map((cell) => {
        const w = stopPosWorld(cell, station);
        return (
          <circle key={cell.lineId} cx={w.x} cy={w.y} r={STOP_DOT_RADIUS} fill={highlightColor} />
        );
      })}
    </g>
  );
}
