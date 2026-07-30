import type { Station } from '../../model/types';
import { stationCellToWorld, stopCenterAt } from '../../geometry/orientation';
import { sameCell, type RowCol } from '../../geometry/lattice';
import { useThemeColors } from '../../state/theme';
import { withAlpha } from '../../util/color';

/**
 * Ghost-lattice overlay shared by the on-canvas label drag and the station
 * layout editor: candidate slots rendered AT the real station in world
 * coordinates. Same visual language as the StopGrid — small zoom-invariant
 * dots for candidates, and a filled ring at the dragged node's true size on
 * the snapped slot so the drop target reads at actual scale. Pure chrome:
 * pointer-events none, excluded from export by the parent group.
 */
export function GhostLattice({
  ghosts,
  over,
  station,
  circle,
  zoom,
  dropR,
}: {
  ghosts: RowCol[];
  /** The snapped slot, if any — drawn as a true-size drop preview ring. */
  over: RowCol | null;
  station: Station;
  /** The ring the station is bound to, or null. Slots are lattice CELLS, so
   *  they resolve through the station's frame — a ring's, not its rounded
   *  octant — or the targets paint off the slots the drop actually lands in. */
  circle: { x: number; y: number } | null;
  zoom: number;
  /** World radius of the node that will land on the snapped slot. */
  dropR: number;
}) {
  // Accent flips with the theme so the drop targets stay visible on the
  // dark canvas (matches the marquee / mode frames / snap guides).
  const theme = useThemeColors();
  const toWorld = (cell: RowCol) =>
    stationCellToWorld(stopCenterAt(cell.row, cell.col), station, circle);
  return (
    <g pointerEvents="none">
      {ghosts.map((g) => {
        const p = toWorld(g);
        const isOver = !!over && sameCell(over, g);
        if (isOver) {
          return (
            <circle
              key={`gl-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
              cx={p.x}
              cy={p.y}
              r={dropR}
              fill={withAlpha(theme.accent, 0.18)}
              stroke={theme.accent}
              strokeWidth={2 / zoom}
            />
          );
        }
        return (
          <circle
            key={`gl-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
            cx={p.x}
            cy={p.y}
            r={3 / zoom}
            fill="rgba(255,255,255,0.85)"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={1.25 / zoom}
          />
        );
      })}
    </g>
  );
}
