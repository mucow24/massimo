import type { Line, Station } from '../../model/types';
import { stationCellToWorld, stationFrameDeg, stopCenterAt } from '../../geometry/orientation';
import { sameCell, type RowCol } from '../../geometry/lattice';
import { LayoutNodeHandle } from './LayoutNodeHandle';
import type { LayoutDragSource } from './useStationLayoutDrag';

/**
 * Ghost-lattice overlay for a station-layout drag: candidate slots rendered AT
 * the real station in world coordinates. Small zoom-invariant white dots for
 * candidates; on the snapped slot, the dragged node's OWN handle in its
 * selected state, so the drop target is the thing that will land there rather
 * than a stand-in circle.
 * Pure chrome: pointer-events none, excluded from export by the parent group.
 */
export function GhostLattice({
  ghosts,
  over,
  station,
  lines,
  source,
  circle,
  zoom,
}: {
  ghosts: RowCol[];
  /** The snapped slot, if any — drawn as a true-size drop preview. */
  over: RowCol | null;
  station: Station;
  lines: Record<string, Line>;
  /** The node being dragged — what the drop preview paints. */
  source: LayoutDragSource;
  /** The ring the station is bound to, or null. Slots are lattice CELLS, so
   *  they resolve through the station's frame — a ring's, not its rounded
   *  octant — or the targets paint off the slots the drop actually lands in. */
  circle: { x: number; y: number } | null;
  zoom: number;
}) {
  const toWorld = (cell: RowCol) =>
    stationCellToWorld(stopCenterAt(cell.row, cell.col), station, circle);
  return (
    <g pointerEvents="none">
      {ghosts.map((g) => {
        // The snapped slot carries the drop preview instead of a dot; that one
        // is drawn below, in the station's own frame.
        if (over && sameCell(over, g)) return null;
        const p = toWorld(g);
        return (
          <circle
            key={`gl-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
            cx={p.x}
            cy={p.y}
            r={3 / zoom}
            fill="#fff"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={1.25 / zoom}
          />
        );
      })}
      {over && (
        // The handle draws in station-LOCAL cells (and a stop's arrow points
        // along the station's axes), so the preview rides the same frame the
        // editor's handles do.
        <g
          data-drop-preview="1"
          transform={`translate(${station.x} ${station.y}) rotate(${stationFrameDeg(station, circle)})`}
        >
          <LayoutNodeHandle
            station={station}
            lines={lines}
            source={source}
            cell={over}
            state="active"
            pointerEvents="none"
          />
        </g>
      )}
    </g>
  );
}
