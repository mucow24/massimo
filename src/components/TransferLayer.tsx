import type { Station, Transfer, TransferAnchor } from '../model/types';
import { resolveDayNight, resolveTransferStyle, type TransferStyle } from '../model/transferStyle';
import { transferEndWorld } from '../geometry/transferEnds';
import { useThemeColors } from '../state/theme';
import { useDoc } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { selectionOutlineTones } from './selectionStyle';

// World-unit gap between a selected transfer's visible edge and its outline,
// so a sliver of canvas separates the ring from the body. World, not screen:
// zoom-scaled geometry would need the committed zoom, and chrome sized off
// the committed zoom snaps when a gesture commits. The gap growing/shrinking
// with the map reads as "attached to the item"; the strokes themselves stay
// screen-constant via vector-effect="non-scaling-stroke". The two-tone
// white-core-over-black-underlay ring is the shared SELECTION_OUTLINE_TONES.
const SELECTION_OUTLINE_PAD = 2.5;

interface Props {
  transfers: Record<string, Transfer>;
  stations: Record<string, Station>;
  // Free transfer anchors, for ends bound to one. Station-hosted anchor ends
  // resolve through `stations`, so both passes need both records — and both
  // MUST resolve an end identically, or a transfer would paint somewhere its
  // own selection outline isn't.
  transferAnchors: Record<string, TransferAnchor>;
  // The constant transfer defaults (TRANSFER_STYLE_DEFAULTS); each transfer
  // may override any field (resolved per transfer via resolveTransferStyle).
  defaults: TransferStyle;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Canvas mouseover → preview a transfer's selection outline at 50% (see
// MapCanvas). Only the bodies pass (TransferLayer) needs these; the outline
// pass (TransferSelectionOutline) shares Props but never hovers, so they live
// here rather than on Props. Enter/leave carry the id so leave can no-op when
// the hover already moved on to another transfer.
interface HoverProps {
  onHoverEnter: (id: string) => void;
  onHoverLeave: (id: string) => void;
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
 * Both the body and the user stroke (when present) are click targets, hit by
 * the stroke of a capsule or the fill of a self-transfer's disc — either way
 * the click region matches the painted shape. Dot-click priority is preserved
 * by the dots layer above:
 * dot pixels absorb clicks and route to the station instead of passing
 * through to the transfer underneath.
 */
export function TransferLayer({
  transfers,
  stations,
  transferAnchors,
  defaults,
  onSelect,
  onHoverEnter,
  onHoverLeave,
}: Omit<Props, 'selectedId'> & HoverProps) {
  // Transfer colors are theme-aware (day/night); resolve to the concrete hex
  // for the active canvas theme, same source as the dots + polygons.
  const darkMode = useDoc((s) => s.darkMode);
  // Stop/anchor cells on a ring-bound station resolve through the ring frame.
  // Render source, not live doc: the stations/anchors props come from the
  // render source via MapCanvas, and a ring mid-capture must resolve against
  // the same frame or a transfer end tears off its station.
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const list = Object.values(transfers);
  if (list.length === 0) return null;

  // Resolve endpoints + effective style once; each pass below iterates this
  // same list in the same order. Endpoints + linecap stay constant between
  // the user stroke and the body. Colors are resolved to hex here so both
  // passes just emit strings.
  const drawable = list.flatMap((t) => {
    const a = transferEndWorld(t.a, stations, transferAnchors, lineCircles);
    const b = transferEndWorld(t.b, stations, transferAnchors, lineCircles);
    // Both ends must resolve for there to be a segment. A dangling end (deleted
    // station, removed anchor) drops the whole transfer quietly — which is why
    // neither load path needs a transfer-endpoint sanitizer.
    if (!a || !b) return [];
    const lineEnds = {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      strokeLinecap: 'round' as const,
    };
    const style = resolveTransferStyle(t, defaults);
    const color = resolveDayNight(style.color, darkMode);
    const strokeColor = resolveDayNight(style.strokeColor, darkMode);
    // Total visible width of the transfer ignoring the selection ring.
    const visibleExtent = style.thickness + 2 * style.strokeWidth;
    // A SELF-transfer's two ends coincide, so the capsule is a disc — painted
    // as a real <circle>, not left to a zero-length round-capped <line>, whose
    // rendering and hit-testing are degenerate cases nothing here needs to
    // depend on (see addSelfTransfer).
    const disc = Math.hypot(b.x - a.x, b.y - a.y) < 1e-9 ? { cx: a.x, cy: a.y } : null;
    return [{ t, lineEnds, disc, style, color, strokeColor, visibleExtent }];
  });

  // Shared between each body and user stroke: both are click targets that
  // select their transfer. The hit region is exactly the painted shape either
  // way — a capsule by its STROKE, a disc by its FILL.
  const clickProps = (id: string, pointerEvents: 'fill' | 'stroke') => ({
    pointerEvents,
    style: { cursor: 'pointer' },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(id);
    },
    onPointerEnter: () => onHoverEnter(id),
    onPointerLeave: () => onHoverLeave(id),
  });

  // One painted shape of a transfer, at `width` in `paint` — the body in each
  // pass, or the halo in the other. Both passes go through here so the disc
  // case can never diverge between them.
  const shape = (
    d: (typeof drawable)[number],
    key: string,
    width: number,
    paint: string,
  ): React.ReactElement =>
    d.disc ? (
      <circle
        key={key}
        data-transfer-id={d.t.id}
        {...d.disc}
        r={width / 2}
        fill={paint}
        {...clickProps(d.t.id, 'fill')}
      />
    ) : (
      <line
        key={key}
        data-transfer-id={d.t.id}
        {...d.lineEnds}
        stroke={paint}
        strokeWidth={width}
        {...clickProps(d.t.id, 'stroke')}
      />
    );

  return (
    <g>
      {drawable.map(
        (d) =>
          d.style.strokeWidth > 0 && shape(d, `halo-${d.t.id}`, d.visibleExtent, d.strokeColor),
      )}
      {drawable.map((d) => shape(d, d.t.id, d.style.thickness, d.color))}
    </g>
  );
}

/**
 * The selected transfer's outline, as its own layer so MapCanvas can mount
 * it ABOVE the station dots (TransferLayer paints below them — a dot rendered
 * over the ring made selection look buried). Two stacked <path>s tracing the
 * capsule perimeter offset SELECTION_OUTLINE_PAD world units out from the
 * visible edge: an underlay and an ink core (selectionOutlineTones), flipping
 * with the theme — white-black-white on light, black-white-black on dark. The
 * two-tone pair contrasts every body color and both canvases (a single
 * stroke-colored ring vanished against black/white bodies — exactly the colors
 * transfers commonly are). Decorative only (`pointerEvents="none"`).
 */
export function TransferSelectionOutline({
  transfers,
  stations,
  transferAnchors,
  defaults,
  selectedId,
}: Omit<Props, 'onSelect'>) {
  // Two-tone ring flips with the theme (WBW on light, BWB on dark).
  const themeColors = useThemeColors();
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const t = selectedId ? transfers[selectedId] : undefined;
  if (!t) return null;
  const a = transferEndWorld(t.a, stations, transferAnchors, lineCircles);
  const b = transferEndWorld(t.b, stations, transferAnchors, lineCircles);
  if (!a || !b) return null;
  const style = resolveTransferStyle(t, defaults);
  const visibleExtent = style.thickness + 2 * style.strokeWidth;
  const d = capsuleOutlinePath(a, b, visibleExtent / 2 + SELECTION_OUTLINE_PAD);
  // Shared two-tone ring: underlay first, then the ink core on top (flips with
  // the theme — white-black-white on light, black-white-black on dark).
  return (
    <g>
      {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
        <path
          key={`sel-${tone}-${t.id}`}
          // Editor chrome, not content: without this the ring bakes into
          // SVG/PNG/PDF exports (transfers render in a non-excluded pass)
          // — same contract as the route-bullet selection ring.
          data-export-exclude="1"
          data-transfer-id={t.id}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
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
