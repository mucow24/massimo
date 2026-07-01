import type { Station } from '../../model/types';
import { localToWorld, stopCenterAt } from '../../geometry/orientation';
import type { RowCol } from '../../geometry/lattice';

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
  zoom,
  dropR,
}: {
  ghosts: RowCol[];
  /** The snapped slot, if any — drawn as a true-size drop preview ring. */
  over: RowCol | null;
  station: Station;
  zoom: number;
  /** World radius of the node that will land on the snapped slot. */
  dropR: number;
}) {
  const toWorld = (cell: RowCol) => localToWorld(stopCenterAt(cell.row, cell.col), station);
  return (
    <g pointerEvents="none">
      {ghosts.map((g) => {
        const p = toWorld(g);
        const isOver =
          over && Math.abs(over.row - g.row) < 1e-4 && Math.abs(over.col - g.col) < 1e-4;
        if (isOver) {
          return (
            <circle
              key={`gl-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
              cx={p.x}
              cy={p.y}
              r={dropR}
              fill="rgba(26,78,168,0.18)"
              stroke="#1a4ea8"
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
