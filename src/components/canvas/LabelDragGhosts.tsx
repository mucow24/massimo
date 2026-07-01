import type { Station } from '../../model/types';
import { STOP_SIZE, localToWorld, stopCenterAt } from '../../geometry/orientation';
import type { LabelDragOverlay } from './useLabelDrag';

/**
 * Ghost-lattice overlay for the on-canvas label drag: the candidate slots
 * rendered AT the real station in world coordinates. Same visual language as
 * the StopGrid — small zoom-invariant dots for candidates, and a filled ring
 * at the label's true cell size on the snapped slot so the drop target reads
 * at actual scale. Pure chrome: pointer-events none, excluded from export by
 * the parent group.
 */
export function LabelDragGhosts({
  overlay,
  station,
  zoom,
}: {
  overlay: LabelDragOverlay;
  station: Station;
  zoom: number;
}) {
  if (overlay.mode !== 'ghost') return null;
  const toWorld = (cell: { row: number; col: number }) =>
    localToWorld(stopCenterAt(cell.row, cell.col), station);
  const over = overlay.over;
  return (
    <g pointerEvents="none">
      {overlay.ghosts.map((g) => {
        const p = toWorld(g);
        const isOver =
          over && Math.abs(over.row - g.row) < 1e-4 && Math.abs(over.col - g.col) < 1e-4;
        if (isOver) {
          return (
            <circle
              key={`lg-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
              cx={p.x}
              cy={p.y}
              r={STOP_SIZE / 2}
              fill="rgba(26,78,168,0.18)"
              stroke="#1a4ea8"
              strokeWidth={2 / zoom}
            />
          );
        }
        return (
          <circle
            key={`lg-${g.row.toFixed(6)},${g.col.toFixed(6)}`}
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
