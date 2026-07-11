import type { LineId, Station, Transfer, TransferEnd } from '../model/types';
import { resolveTransferStyle, type TransferStyle } from '../model/transferStyle';
import { stopPosWorld } from '../geometry/interlining';
import { useThemeColors } from '../state/theme';

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  // The doc-level transfer settings; each transfer may override any field
  // (resolved per transfer via resolveTransferStyle).
  defaults: TransferStyle;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// World-unit padding added to each side of a selected transfer's outline
// (in addition to the user's stroke, if any). Constant-in-world means the
// outline stays a consistent thickness relative to the stroke at any zoom
// — replaces the legacy `6/zoom` halo that vanished when zoomed out.
const SELECTION_OUTLINE_PAD = 2.5;
// Dash pattern for the selection outline — coarser than the item rings' 4/3
// because it reads along the rim of a thick capsule, not a thin outline.
const SELECTION_OUTLINE_DASH = '6 4';

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
 *   1. Selection outlines — only for the selected transfer. The dashed
 *      themeColors.selectionStroke ring every other item type uses: it
 *      contrasts the CANVAS (black on light, white on dark), and the dashes
 *      keep it legible even where the transfer body matches the stroke
 *      color. (The old halo contrasted the transfer's own color instead — a
 *      black transfer got a white halo that vanished on the light canvas.)
 *   2. User strokes — only for transfers whose effective strokeWidth > 0. A
 *      halo around each body in that transfer's stroke color.
 *   3. Bodies — the colored stroke at each transfer's effective thickness.
 *
 * Styling resolves per transfer: overrides on the Transfer win over the
 * doc-level `defaults` (see resolveTransferStyle).
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
export function TransferLayer({ transfers, stations, defaults, selectedId, onSelect }: Props) {
  const themeColors = useThemeColors();
  const list = Object.values(transfers);
  if (list.length === 0) return null;

  // Resolve endpoints + effective style once; each pass below iterates this
  // same list in the same order. Endpoints + linecap stay constant between
  // the selection ring, the user stroke, and the body.
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
    const style = resolveTransferStyle(t, defaults);
    // Total visible width of the transfer ignoring the selection ring.
    const visibleExtent = style.thickness + 2 * style.strokeWidth;
    return [{ t, lineEnds, style, visibleExtent }];
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
        ({ t, lineEnds, visibleExtent }) =>
          t.id === selectedId && (
            <line
              key={`sel-${t.id}`}
              // Editor chrome, not content: without this the ring bakes into
              // SVG/PNG/PDF exports (transfers render in a non-excluded pass)
              // — same contract as the route-bullet selection ring.
              data-export-exclude="1"
              data-transfer-id={t.id}
              {...lineEnds}
              stroke={themeColors.selectionStroke}
              strokeWidth={visibleExtent + 2 * SELECTION_OUTLINE_PAD}
              strokeDasharray={SELECTION_OUTLINE_DASH}
              // Butt caps, overriding lineEnds' round: SVG caps every DASH
              // end, and a round cap on a stroke this wide (radius ≥ 3.5)
              // overlaps the 4-unit gaps completely — the "dashed" ring
              // would render as a solid band.
              strokeLinecap="butt"
              pointerEvents="none"
            />
          ),
      )}
      {drawable.map(
        ({ t, lineEnds, style, visibleExtent }) =>
          style.strokeWidth > 0 && (
            <line
              key={`halo-${t.id}`}
              data-transfer-id={t.id}
              {...lineEnds}
              stroke={style.strokeColor}
              strokeWidth={visibleExtent}
              {...clickProps(t.id)}
            />
          ),
      )}
      {drawable.map(({ t, lineEnds, style }) => (
        <line
          key={t.id}
          data-transfer-id={t.id}
          {...lineEnds}
          stroke={style.color}
          strokeWidth={style.thickness}
          {...clickProps(t.id)}
        />
      ))}
    </g>
  );
}
