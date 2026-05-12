import type {
  Rotation,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  LineId,
} from '../model/types';
import { STOP_SIZE } from './orientation';
import { dirIndex8, stopPosWorld, travelDirWorld } from './interlining';
import type { Vec2 } from './vec';

// A canonical "rendered world position" lookup for stops.
//
// For every stop EXCEPT those in a diagonal interline group at their station,
// the rendered position equals the cell-grid world position. For diagonal
// interline groups (multiple stops on the same diagonal axis at the same
// station, perp-adjacent along the cell grid), the stops are compressed
// perpendicular-to-the-band so consecutive members sit at STOP_SIZE perp
// spacing — matching the band stripe pitch.
//
// Logical vs rendered: cell positions are authoritative for editing, hit
// testing, label layout, and redistribute. Rendered positions are for
// everything visual (bands, markers, transfers, snap targets, in-canvas
// previews). The group's centroid is unchanged by construction, so the
// band centerline stays anchored where it was.
export type RenderedStopPositions = (stationId: StationId, lineId: LineId) => Vec2;

const TOL = 0.5;
const DIAGONAL_CELL_STEP = STOP_SIZE * Math.SQRT2;

// "Cell step" is the world-frame distance between two cells that are
// perp-adjacent in the LOCAL cell grid for this stop's orientation. Cells are
// axis-aligned in the local frame at multiples of STOP_SIZE, so:
//   - cardinal-local orientations (auto-vertical, auto-horizontal):
//     perp-adjacent cells differ by one local-axis step → STOP_SIZE.
//   - diagonal-local orientations (auto-ne-sw, auto-nw-se):
//     perp-adjacent cells differ by (±1, ±1) → STOP_SIZE·√2.
// Rotation is isometric, so the step is the same in world coords.
// IMPORTANT: this depends on LOCAL orientation, not the world-axis bucket —
// a cardinal-local stop on a station rotated 45° has a diagonal world axis
// but its cells are still STOP_SIZE-apart perpendicular to travel.
function cellStepFor(orientation: StopOrientation): number {
  return orientation === 'auto-ne-sw' || orientation === 'auto-nw-se'
    ? DIAGONAL_CELL_STEP
    : STOP_SIZE;
}

// Perp axis per bucket index (`dirIndex8 % 4`). 90° rotation of the canonical
// travel axis for that bucket, in screen-y-down coords. Sign choice is
// arbitrary — sorting / projection use the axis as a line, not a vector.
function perpAxisForBucket(bucket: number): Vec2 {
  const SQRT2_2 = Math.SQRT1_2;
  switch (bucket) {
    case 0:
      return { x: 0, y: 1 }; // travel ±x → perp ±y
    case 1:
      return { x: -SQRT2_2, y: SQRT2_2 }; // travel NW-SE → perp NE-SW (taking SW here)
    case 2:
      return { x: 1, y: 0 }; // travel ±y → perp ±x
    default:
      return { x: SQRT2_2, y: SQRT2_2 }; // travel NE-SW → perp NW-SE (taking SE here)
  }
}

interface BucketEntry {
  cell: StopCell;
  worldPos: Vec2;
  perp: number;
}

export function computeRenderedStopPositions(
  stations: Record<StationId, Station>,
): RenderedStopPositions {
  const map = new Map<string, Vec2>();

  for (const station of Object.values(stations)) {
    const buckets: Record<number, BucketEntry[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const cell of station.stops) {
      const worldPos = stopPosWorld(cell, station);
      const bucket = dirIndex8(travelDirWorld(cell, station, null)) % 4;
      const perpAxis = perpAxisForBucket(bucket);
      const perp = worldPos.x * perpAxis.x + worldPos.y * perpAxis.y;
      buckets[bucket].push({ cell, worldPos, perp });
    }

    for (const [bucketStr, items] of Object.entries(buckets)) {
      if (items.length === 0) continue;
      const bucket = Number(bucketStr);
      // Within a single station, every stop in a given bucket shares the same
      // local orientation (each of the 4 orientations maps to a different
      // bucket under any fixed rotation). So the local cell step is uniform
      // across the bucket — read it off the first item.
      const cellStep = cellStepFor(items[0].cell.orientation);
      const perpAxis = perpAxisForBucket(bucket);
      items.sort((a, b) => a.perp - b.perp);

      let runStart = 0;
      for (let i = 1; i <= items.length; i++) {
        const isBreak =
          i === items.length || Math.abs(items[i].perp - items[i - 1].perp - cellStep) > TOL;
        if (!isBreak) continue;
        const runLen = i - runStart;
        if (runLen === 1) {
          const { cell, worldPos } = items[runStart];
          map.set(`${station.id}|${cell.lineId}`, worldPos);
        } else {
          let centroid = 0;
          for (let k = runStart; k < i; k++) centroid += items[k].perp;
          centroid /= runLen;
          for (let k = 0; k < runLen; k++) {
            const item = items[runStart + k];
            const newPerp = centroid + (k - (runLen - 1) / 2) * STOP_SIZE;
            const delta = newPerp - item.perp;
            map.set(`${station.id}|${item.cell.lineId}`, {
              x: item.worldPos.x + delta * perpAxis.x,
              y: item.worldPos.y + delta * perpAxis.y,
            });
          }
        }
        runStart = i;
      }
    }
  }

  return (stationId, lineId) => {
    const hit = map.get(`${stationId}|${lineId}`);
    if (hit) return hit;
    const station = stations[stationId];
    if (station) return { x: station.x, y: station.y };
    return { x: 0, y: 0 };
  };
}

// Build a stations snapshot where the dragged station's tentative position,
// rotation, and stops override its entry (or insert it if it isn't there
// yet). Used by snap so the compression pass sees the dragged station's
// pending state, not its committed state.
export function withDraggedSnapshot(
  stations: Record<StationId, Station>,
  draggedId: StationId,
  stops: StopCell[],
  x: number,
  y: number,
  rotation: Rotation,
): Record<StationId, Station> {
  const existing = stations[draggedId];
  const synthesized: Station = existing
    ? { ...existing, x, y, rotation, stops }
    : {
        id: draggedId,
        name: '',
        x,
        y,
        rotation,
        stops,
        label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
      };
  return { ...stations, [draggedId]: synthesized };
}
