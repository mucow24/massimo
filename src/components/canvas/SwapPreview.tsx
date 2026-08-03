import type { Line, LineId, Station } from '../../model/types';
import { stationFrameDeg, stopCenterAt } from '../../geometry/orientation';
import type { RowCol } from '../../geometry/lattice';
import { sourceCellOf } from '../inspector/stopGridDrag';
import { LayoutNodeHandle, LAYOUT_RING_ACTIVE, layoutHandleRadius } from './LayoutNodeHandle';
import type { LayoutDragSource } from './useStationLayoutDrag';

// Arrow geometry, world units (like every other measurement in this editor —
// see the note on RING_WIDTH). Read against a 14-unit lattice cell: a ~2-wide
// shaft with a head half a cell long.
const SHAFT_HALF = 1.1;
const HEAD_LEN = 5;
const HEAD_HALF = 3.2;
// How far past the WIDER of the two rings each shaft runs. The arrows flank
// the swap axis rather than crossing it, so they stay legible at the shortest
// possible swap — two tangent stops, one cell apart — where there is no room
// for anything drawn BETWEEN the nodes.
const ARROW_CLEAR = 3.5;

// The ghosted partner is the only thing here that hasn't happened yet; the
// rest of the preview is the state you get on release.
const GHOST_OPACITY = 0.5;

const round = (v: number) => Number(v.toFixed(4));

/** One arrow of the pair, pointing along +x from the origin. */
const arrowPath = (len: number): string => {
  const t = len - Math.min(HEAD_LEN, len);
  return [
    `M 0 ${-SHAFT_HALF}`,
    `L ${round(t)} ${-SHAFT_HALF}`,
    `L ${round(t)} ${-HEAD_HALF}`,
    `L ${round(len)} 0`,
    `L ${round(t)} ${HEAD_HALF}`,
    `L ${round(t)} ${SHAFT_HALF}`,
    `L 0 ${SHAFT_HALF}`,
    'Z',
  ].join(' ');
};

/**
 * Live preview for a station-layout drag that has resolved onto ANOTHER stop —
 * a swap, not a lattice drop. It answers the one question the drop leaves open,
 * which is what the release will look like: the dragged stop stands at the
 * target cell exactly as it will land, and its partner is ghosted back at the
 * cell being vacated, blue-ringed like the other end of a selection. A pair of
 * arrows flanking the axis says the two are trading rather than stacking.
 *
 * Painted INSTEAD of GhostLattice: the candidate slots have already lost — one
 * stop won — so the amber lattice and its projection anchor would only add a
 * third colour to a two-node story (the editor drops its own gold for the same
 * reason). Pure chrome: pointer-events none, export-excluded by the parent.
 */
export function SwapPreview({
  station,
  lines,
  source,
  target,
  circle,
}: {
  station: Station;
  lines: Record<string, Line>;
  /** The node being dragged. Always a stop — labels and anchors never swap. */
  source: LayoutDragSource;
  /** The stop it landed on: the cell it takes, and whose stop comes back. */
  target: RowCol & { lineId: string };
  /** The ring the station is bound to, or null. Cells resolve through the
   *  station's frame, so the preview turns with the handles it replaces. */
  circle: { x: number; y: number } | null;
}) {
  const from = sourceCellOf(station, source);
  if (!from) return null;
  const partner: LayoutDragSource = { kind: 'stop', lineId: target.lineId as LineId };

  const a = stopCenterAt(from.row, from.col);
  const b = stopCenterAt(target.row, target.col);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // Arrows only; the two handles below stand on their own if the cells
  // somehow coincide (they can't — findDropTarget skips the source stop).
  const arrows: { role: 'incoming' | 'outgoing'; transform: string }[] = [];
  if (len > 1e-6) {
    const off =
      Math.max(
        layoutHandleRadius(station, lines, source),
        layoutHandleRadius(station, lines, partner),
      ) + ARROW_CLEAR;
    // Unit axis and its perpendicular: the pair runs one to each side.
    const ux = dx / len;
    const uy = dy / len;
    const deg = round((Math.atan2(dy, dx) * 180) / Math.PI);
    arrows.push({
      role: 'incoming',
      transform: `translate(${round(a.x - uy * off)} ${round(a.y + ux * off)}) rotate(${deg})`,
    });
    arrows.push({
      role: 'outgoing',
      transform: `translate(${round(b.x + uy * off)} ${round(b.y - ux * off)}) rotate(${round(
        deg > 0 ? deg - 180 : deg + 180,
      )})`,
    });
  }

  return (
    <g pointerEvents="none" data-swap-preview="1">
      {/* Handles draw in station-LOCAL cells (and a stop's arrow points along
          the station's axes), so the whole preview rides the same frame the
          editor's handles do. */}
      <g
        transform={`translate(${station.x} ${station.y}) rotate(${stationFrameDeg(station, circle)})`}
      >
        {arrows.map((ar) => (
          <path
            key={ar.role}
            data-swap-arrow={ar.role}
            transform={ar.transform}
            d={arrowPath(len)}
            fill={LAYOUT_RING_ACTIVE}
            stroke="rgba(0, 0, 0, 0.55)"
            strokeWidth={0.6}
            strokeLinejoin="round"
          />
        ))}
        {/* The partner, ghosted at the cell the drag is vacating. */}
        <g data-swap-role="outgoing" opacity={GHOST_OPACITY}>
          <LayoutNodeHandle
            station={station}
            lines={lines}
            source={partner}
            cell={from}
            state="active"
            pointerEvents="none"
          />
        </g>
        {/* The dragged stop, standing where it lands. */}
        <g data-swap-role="incoming">
          <LayoutNodeHandle
            station={station}
            lines={lines}
            source={source}
            cell={target}
            state="active"
            pointerEvents="none"
          />
        </g>
      </g>
    </g>
  );
}
