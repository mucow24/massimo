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
  par: number;
}

interface RunInfo {
  perpAxis: Vec2;
  parAxis: Vec2;
  cellStep: number;
  items: BucketEntry[];
  centroid: number; // mean perp of run members (cell-grid)
}

export function computeRenderedStopPositions(
  stations: Record<StationId, Station>,
): RenderedStopPositions {
  const map = new Map<string, Vec2>();

  for (const station of Object.values(stations)) {
    // Pass 1 — bucket stops by world axis, sort by perp within bucket, and
    // collect runs of size > 1. A "run" is a maximal sequence of stops where
    // consecutive members are perp-adjacent (Δperp ≈ cellStep) AND share the
    // same parallel position (so they form a valid interline band, matching
    // the constraints `buildBands` enforces).
    const buckets: Record<number, BucketEntry[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const cell of station.stops) {
      const worldPos = stopPosWorld(cell, station);
      const bucket = dirIndex8(travelDirWorld(cell, station, null)) % 4;
      const perpAxis = perpAxisForBucket(bucket);
      const parAxis: Vec2 = { x: -perpAxis.y, y: perpAxis.x };
      const perp = worldPos.x * perpAxis.x + worldPos.y * perpAxis.y;
      const par = worldPos.x * parAxis.x + worldPos.y * parAxis.y;
      buckets[bucket].push({ cell, worldPos, perp, par });
    }

    const runs: RunInfo[] = [];
    const inRun = new Set<LineId>();
    for (const [bucketStr, items] of Object.entries(buckets)) {
      if (items.length === 0) continue;
      const bucket = Number(bucketStr);
      // Within a single station, every stop in a given bucket shares the same
      // local orientation (each of the 4 orientations maps to a different
      // bucket under any fixed rotation). So the local cell step is uniform
      // across the bucket — read it off the first item.
      const cellStep = cellStepFor(items[0].cell.orientation);
      const perpAxis = perpAxisForBucket(bucket);
      const parAxis: Vec2 = { x: -perpAxis.y, y: perpAxis.x };
      items.sort((a, b) => a.perp - b.perp);

      let runStart = 0;
      for (let i = 1; i <= items.length; i++) {
        const isBreak =
          i === items.length ||
          Math.abs(items[i].perp - items[i - 1].perp - cellStep) > TOL ||
          Math.abs(items[i].par - items[i - 1].par) > TOL;
        if (!isBreak) continue;
        const runLen = i - runStart;
        if (runLen > 1) {
          const runItems = items.slice(runStart, i);
          let centroid = 0;
          for (const it of runItems) centroid += it.perp;
          centroid /= runLen;
          runs.push({ perpAxis, parAxis, cellStep, items: runItems, centroid });
          for (const it of runItems) inRun.add(it.cell.lineId);
        }
        runStart = i;
      }
    }

    // Pass 2 — compute run members' compressed world positions. These are
    // the seeds for the trailer-propagation pass.
    const positions = new Map<LineId, Vec2>();
    for (const run of runs) {
      const n = run.items.length;
      for (let k = 0; k < n; k++) {
        const item = run.items[k];
        const newPerp = run.centroid + (k - (n - 1) / 2) * STOP_SIZE;
        const delta = newPerp - item.perp;
        positions.set(item.cell.lineId, {
          x: item.worldPos.x + delta * run.perpAxis.x,
          y: item.worldPos.y + delta * run.perpAxis.y,
        });
      }
    }

    // Pass 3 — pull trailers along the band. A trailer is any stop NOT in a
    // compression run that's king-adjacent (Chebyshev ≤ 1) in the local cell
    // grid to an already-placed stop ("anchor"). The trailer's rendered
    // position is:
    //
    //   anchor.rendered + STOP_SIZE · unit_world_direction(trailer.cell − anchor.cell)
    //
    // i.e. one stripe-width from the anchor, in the same world direction the
    // trailer lay from the anchor in the cell grid. This unifies two cases:
    //   • Trailer along the band's perp axis (e.g. one diagonal step past
    //     the SW end of the band): lands at the would-be next stripe slot.
    //   • Trailer off-axis (e.g. directly south of a band member): lands one
    //     stripe-width in the cell-grid direction (same as if the band
    //     weren't compressed).
    // Chain propagation: a trailer king-adjacent only to another trailer
    // still inherits a position via transitive BFS.
    const queue: StopCell[] = station.stops.filter((c) => positions.has(c.lineId));
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curPos = positions.get(cur.lineId)!;
      const curCellWorld = stopPosWorld(cur, station);
      for (const other of station.stops) {
        if (positions.has(other.lineId)) continue;
        const dr = Math.abs(other.row - cur.row);
        const dc = Math.abs(other.col - cur.col);
        if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) continue;
        const otherCellWorld = stopPosWorld(other, station);
        const dx = otherCellWorld.x - curCellWorld.x;
        const dy = otherCellWorld.y - curCellWorld.y;
        const mag = Math.hypot(dx, dy);
        if (mag === 0) continue;
        positions.set(other.lineId, {
          x: curPos.x + (STOP_SIZE * dx) / mag,
          y: curPos.y + (STOP_SIZE * dy) / mag,
        });
        queue.push(other);
      }
    }

    // Pass 4 — emit rendered positions. Stops not seen by the pipeline stay
    // at their cell-grid world position.
    for (const cell of station.stops) {
      const placed = positions.get(cell.lineId);
      map.set(`${station.id}|${cell.lineId}`, placed ?? stopPosWorld(cell, station));
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
        label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'auto' },
      };
  return { ...stations, [draggedId]: synthesized };
}
