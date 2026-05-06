import type { Station, Transfer } from '../model/types';

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  selectedId: string | null;
  zoom: number;
  onSelect: (id: string) => void;
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
        const a = stations[t.stationA];
        const b = stations[t.stationB];
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
