import type { LineId, Station, Transfer, TransferEnd } from '../model/types';
import { stopPosWorld } from '../geometry/interlining';
import { legibleTextOn } from '../util/color';

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  color: string;
  thickness: number;
  strokeColor: string;
  strokeWidth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// World-unit padding added to each side of a selected transfer's outline
// (in addition to the user's stroke, if any). Constant-in-world means the
// outline stays a consistent thickness relative to the stroke at any zoom
// — replaces the legacy `6/zoom` halo that vanished when zoomed out.
const SELECTION_OUTLINE_PAD = 1;

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
  return stopPosWorld(cell, station);
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
 * Renders all inter-station transfers in three flat passes across the whole
 * set (painted in document order so each subsequent pass lays on top):
 *
 *   1. Selection outlines — only for the selected transfer. Color is the
 *      legible black/white for the outermost visible color (the user stroke
 *      if present, otherwise the body).
 *   2. User strokes — only when `strokeWidth > 0`. A halo around each body
 *      in the user's chosen color.
 *   3. Bodies — the colored stroke at the user's chosen thickness.
 *
 * Flat passes (rather than per-transfer groups) mean every body paints above
 * every halo, so where thick transfers overlap the halo traces only the
 * outside of their union — one transfer's halo never cuts across another's
 * body, preserving the continuous-capsule look.
 *
 * Both the body and the user stroke (when present) are click targets via
 * `pointerEvents="stroke"`, so the click region matches the perceived width
 * of the transfer. The selection outline is decorative only
 * (`pointerEvents="none"`). Dot-click priority is preserved by the dots
 * layer above: dot pixels absorb clicks and route to the station instead of
 * passing through to the transfer underneath.
 */
export function TransferLayer({
  transfers,
  stations,
  color,
  thickness,
  strokeColor,
  strokeWidth,
  selectedId,
  onSelect,
}: Props) {
  const list = Object.values(transfers);
  if (list.length === 0) return null;
  const hasUserStroke = strokeWidth > 0;
  // Total visible width of a transfer ignoring the selection ring.
  const visibleExtent = thickness + 2 * strokeWidth;
  // Color the selection ring sits against: the user stroke if it's drawn,
  // otherwise the body color.
  const outermostVisibleColor = hasUserStroke ? strokeColor : color;
  const selectionRingColor = legibleTextOn(outermostVisibleColor);

  // Resolve endpoints once; each pass below iterates this same list in the
  // same order. Endpoints + linecap stay constant between the selection
  // ring, the user stroke, and the body.
  const drawable = list.flatMap((t) => {
    const a = endpointWorld(t.a, stations);
    const b = endpointWorld(t.b, stations);
    if (!a || !b) return [];
    const lineEnds = {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      strokeLinecap: 'round' as const,
    };
    return [{ t, lineEnds }];
  });

  // Shared between each body and user stroke: both are click targets that
  // select their transfer.
  const clickProps = (id: string) => ({
    pointerEvents: 'stroke' as const,
    style: { cursor: 'pointer' },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(id);
    },
  });

  return (
    <g>
      {drawable.map(
        ({ t, lineEnds }) =>
          t.id === selectedId && (
            <line
              key={`sel-${t.id}`}
              data-transfer-id={t.id}
              {...lineEnds}
              stroke={selectionRingColor}
              strokeWidth={visibleExtent + 2 * SELECTION_OUTLINE_PAD}
              pointerEvents="none"
            />
          ),
      )}
      {hasUserStroke &&
        drawable.map(({ t, lineEnds }) => (
          <line
            key={`halo-${t.id}`}
            data-transfer-id={t.id}
            {...lineEnds}
            stroke={strokeColor}
            strokeWidth={visibleExtent}
            {...clickProps(t.id)}
          />
        ))}
      {drawable.map(({ t, lineEnds }) => (
        <line
          key={t.id}
          data-transfer-id={t.id}
          {...lineEnds}
          stroke={color}
          strokeWidth={thickness}
          {...clickProps(t.id)}
        />
      ))}
    </g>
  );
}
