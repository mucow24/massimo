import type { LineId, Station, Transfer, TransferEnd } from '../model/types';
import { stopCenterAt } from '../geometry/orientation';

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  selectedId: string | null;
  zoom: number;
  onSelect: (id: string) => void;
}

/**
 * World position of a station's specific dot. Falls back to the station's
 * anchor when no lineId is given or the line isn't on this station (e.g.,
 * after the line was deleted).
 */
export function transferEndWorld(
  station: Station,
  lineId: LineId | null,
): { x: number; y: number } {
  if (!lineId) return { x: station.x, y: station.y };
  const cell = station.stops.find((c) => c.lineId === lineId);
  if (!cell) return { x: station.x, y: station.y };
  const local = stopCenterAt(cell.row, cell.col);
  const a = (station.rotation * Math.PI) / 4;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return {
    x: station.x + local.x * cs - local.y * sn,
    y: station.y + local.x * sn + local.y * cs,
  };
}

function endpointWorld(
  end: TransferEnd,
  stations: Record<string, Station>,
): { x: number; y: number } | null {
  const st = stations[end.stationId];
  if (!st) return null;
  return transferEndWorld(st, end.lineId);
}

/**
 * Renders all inter-station transfers as 2px black lines, plus a transparent
 * thicker overlay per transfer so they're easy to click without forcing the
 * user onto the 2px stroke. Selected transfers get a teal halo.
 */
export function TransferLayer({ transfers, stations, selectedId, zoom, onSelect }: Props) {
  const list = Object.values(transfers);
  if (list.length === 0) return null;
  // Generous hit width in screen pixels so easy to click.
  const hitWidth = 14 / zoom;
  return (
    <g>
      {list.map((t) => {
        const a = endpointWorld(t.a, stations);
        const b = endpointWorld(t.b, stations);
        if (!a || !b) return null;
        const isSelected = selectedId === t.id;
        return (
          <g key={t.id}>
            {isSelected && (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#1488a0"
                strokeWidth={6 / zoom}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#000"
              strokeWidth={2}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={hitWidth}
              strokeLinecap="round"
              pointerEvents="stroke"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t.id);
              }}
            />
          </g>
        );
      })}
    </g>
  );
}
