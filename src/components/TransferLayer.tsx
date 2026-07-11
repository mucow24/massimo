import type { LineId, Station, Transfer, TransferEnd } from '../model/types';
import { resolveTransferStyle, type TransferStyle } from '../model/transferStyle';
import { stopPosWorld } from '../geometry/interlining';

// World-unit gap between a selected transfer's visible edge and its outline,
// so a sliver of canvas separates the ring from the body. World, not screen:
// zoom-scaled geometry would need the committed zoom, and chrome sized off
// the committed zoom snaps when a gesture commits. The gap growing/shrinking
// with the map reads as "attached to the item"; the strokes themselves stay
// screen-constant via vector-effect="non-scaling-stroke".
const SELECTION_OUTLINE_PAD = 2.5;
// The outline is two-tone: a white core over a black underlay, leaving
// SELECTION_EDGE_WIDTH of black visible on each side of the core. Fixed
// white-on-black (no theme flip): the pair is legible against any body
// color and any canvas in both themes. Screen px, held by vector-effect.
const SELECTION_CORE_WIDTH = 2;
const SELECTION_EDGE_WIDTH = 1;

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  // The doc-level transfer settings; each transfer may override any field
  // (resolved per transfer via resolveTransferStyle).
  defaults: TransferStyle;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Perimeter of the capsule a round-capped line of radius `r` sweeps from `a`
 * to `b`: two edge-parallel segments joined by semicircle end caps (sweep 0
 * bulges the caps outward, away from the segment). Coincident endpoints — a
 * round-cap dot — degenerate to a circle instead of NaN offsets.
 */
export function capsuleOutlinePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: number,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return (
      `M ${a.x + r} ${a.y} ` +
      `A ${r} ${r} 0 1 0 ${a.x - r} ${a.y} ` +
      `A ${r} ${r} 0 1 0 ${a.x + r} ${a.y} Z`
    );
  }
  const nx = -dy / len;
  const ny = dx / len;
  return (
    `M ${a.x + nx * r} ${a.y + ny * r} ` +
    `L ${b.x + nx * r} ${b.y + ny * r} ` +
    `A ${r} ${r} 0 0 0 ${b.x - nx * r} ${b.y - ny * r} ` +
    `L ${a.x - nx * r} ${a.y - ny * r} ` +
    `A ${r} ${r} 0 0 0 ${a.x + nx * r} ${a.y + ny * r} Z`
  );
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
 * Renders all inter-station transfers in two flat passes across the whole
 * set (painted in document order so the second pass lays on top):
 *
 *   1. User strokes — only for transfers whose effective strokeWidth > 0. A
 *      halo around each body in that transfer's stroke color.
 *   2. Bodies — the colored stroke at each transfer's effective thickness.
 *
 * The selected transfer's outline is NOT here: it renders via
 * TransferSelectionOutline, mounted separately in MapCanvas above the
 * station dots (this whole layer paints below them).
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
 * of the transfer. Dot-click priority is preserved by the dots layer above:
 * dot pixels absorb clicks and route to the station instead of passing
 * through to the transfer underneath.
 */
export function TransferLayer({
  transfers,
  stations,
  defaults,
  onSelect,
}: Omit<Props, 'selectedId'>) {
  const list = Object.values(transfers);
  if (list.length === 0) return null;

  // Resolve endpoints + effective style once; each pass below iterates this
  // same list in the same order. Endpoints + linecap stay constant between
  // the user stroke and the body.
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

/**
 * The selected transfer's outline, as its own layer so MapCanvas can mount
 * it ABOVE the station dots (TransferLayer paints below them — a dot rendered
 * over the ring made selection look buried). Two stacked <path>s tracing the
 * capsule perimeter offset SELECTION_OUTLINE_PAD world units out from the
 * visible edge: a black underlay and a white core, leaving
 * SELECTION_EDGE_WIDTH of black on each side. The two-tone pair contrasts
 * every body color and both canvases without theme flips (a single
 * stroke-colored ring vanished against black/white bodies — exactly the
 * colors transfers commonly are). Decorative only (`pointerEvents="none"`).
 */
export function TransferSelectionOutline({
  transfers,
  stations,
  defaults,
  selectedId,
}: Omit<Props, 'onSelect'>) {
  const t = selectedId ? transfers[selectedId] : undefined;
  if (!t) return null;
  const a = endpointWorld(t.a, stations);
  const b = endpointWorld(t.b, stations);
  if (!a || !b) return null;
  const style = resolveTransferStyle(t, defaults);
  const visibleExtent = style.thickness + 2 * style.strokeWidth;
  const d = capsuleOutlinePath(a, b, visibleExtent / 2 + SELECTION_OUTLINE_PAD);
  // Black underlay, then the white core on top of it.
  const layers = [
    {
      key: `sel-edge-${t.id}`,
      stroke: '#000000',
      width: SELECTION_CORE_WIDTH + 2 * SELECTION_EDGE_WIDTH,
    },
    { key: `sel-core-${t.id}`, stroke: '#ffffff', width: SELECTION_CORE_WIDTH },
  ];
  return (
    <g>
      {layers.map(({ key, stroke, width }) => (
        <path
          key={key}
          // Editor chrome, not content: without this the ring bakes into
          // SVG/PNG/PDF exports (transfers render in a non-excluded pass)
          // — same contract as the route-bullet selection ring.
          data-export-exclude="1"
          data-transfer-id={t.id}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          // Screen-constant weight without any zoom math: the browser
          // recomputes the stroke against the live viewBox, so the ring
          // tracks in-flight gestures instead of snapping on commit.
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </g>
  );
}
