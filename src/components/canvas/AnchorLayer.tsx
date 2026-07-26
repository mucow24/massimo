import type { Station, TransferAnchor, TransferEnd } from '../../model/types';
import { stationAnchorWorld } from '../../geometry/transferEnds';
import { useThemeColors } from '../../state/theme';
import { AnchorMark, ANCHOR_ICON_BOX } from '../AnchorGlyph';
import { selectionOutlineTones } from '../selectionStyle';

/**
 * Painted diameter of an anchor's disc, in world units. Deliberately smaller
 * than a lattice cell (STOP_SIZE = 14): an anchor is scaffolding sitting on top
 * of finished artwork, so it reads as a mark rather than competing with the
 * stop dots around it.
 */
export const ANCHOR_SIZE = 10.5;

/** World-unit gap between the disc's edge and its selection ring, matching the
 *  transfer outline's pad so a selected anchor and a selected transfer read as
 *  the same kind of chrome. */
const SELECTION_OUTLINE_PAD = 2.5;

/** The two arms of TransferEnd that name an anchor — everything this layer can
 *  paint. (The third arm is a station stop, which is not an anchor.) */
type AnchorEnd = Extract<TransferEnd, { anchorId: string }>;

/** Is this end a station-hosted anchor rather than a free one? */
const isHosted = (end: AnchorEnd): end is Extract<AnchorEnd, { stationId: string }> =>
  'stationId' in end;

/**
 * Stable per-anchor key. Anchor ids are unique across both homes already, but
 * qualifying the hosted ones keeps the key self-describing — and this is the
 * value stored in `hoveredAnchorKey`, so it has to be derivable from the end
 * alone at both the write and the compare.
 */
const anchorKey = (end: AnchorEnd): string =>
  isHosted(end) ? `${end.stationId}:${end.anchorId}` : end.anchorId;

/**
 * Transfer anchors, in one pass over both homes.
 *
 * BOTH homes are transfer endpoints — that is the entire reason anchors exist,
 * so both must be clickable while picking one (`hostedLive` / `freeLive`). What
 * differs is what they do OUTSIDE that gesture:
 *
 *   - FREE anchors are canvas objects: select, drag, marquee, nudge, delete.
 *   - HOSTED anchors are station-grid cells, edited only in the layout editor.
 *     In idle they go pointer-transparent so they never steal a click from the
 *     station beneath — the stop-dot rule, which is what "anchors function no
 *     differently than station dots" means for the idle case.
 *
 * The whole layer is EDITOR CHROME: MapCanvas mounts it inside a
 * `data-export-exclude` subtree, so an anchor never reaches an SVG/PNG/PDF
 * export while the transfer bound to it still prints. That asymmetry is the
 * point — the anchor is scaffolding, the transfer is the artwork.
 *
 * The disc is drawn in the CANVAS frame, not the station's: a hosted anchor's
 * POSITION turns with its station (stationAnchorWorld), but the mark itself
 * stays upright, because it is an icon rather than map ink.
 */
export function AnchorLayer({
  transferAnchors,
  stations,
  selectedIds,
  hoveredKey,
  onHover,
  freeLive,
  picking,
  onPointerDown,
  onClick,
}: {
  transferAnchors: Record<string, TransferAnchor>;
  stations: Record<string, Station>;
  selectedIds: readonly string[];
  /** The layer key of the anchor under the cursor (see hoveredAnchorKey). */
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  /** Free anchors take pointer events: selecting, dragging, or being picked as
   *  a transfer end. False in modes that own the background click. */
  freeLive: boolean;
  /** True while picking transfer ends. Two things hang off it: HOSTED anchors
   *  take pointer events (that is the one gesture they join on the main map),
   *  and the hover ring paints. The ring is scoped to this mode on purpose —
   *  anchors are scaffolding, so they get an affordance exactly when the user
   *  is being asked to click one, and stay quiet the rest of the time. */
  picking: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  /** Receives the anchor's TransferEnd, so the caller never has to reconstruct
   *  which home it came from. */
  onClick: (end: TransferEnd, e: React.MouseEvent) => void;
}) {
  const theme = useThemeColors();
  const scale = ANCHOR_SIZE / ANCHOR_ICON_BOX;
  const r = ANCHOR_SIZE / 2;

  // One row per painted anchor. `end` is the ONLY identity carried: which home
  // it came from, its react key, and every data-* attribute all derive from it
  // (see anchorKey / isHosted below), so there is nothing to keep in sync.
  // Hosted first, so a free anchor dropped on one paints over it.
  const drawn: { end: AnchorEnd; x: number; y: number }[] = [
    ...Object.values(stations).flatMap((st) =>
      (st.transferAnchors ?? []).map((cell) => ({
        // Station-keyed, so the end resolves in one lookup.
        end: { stationId: st.id, anchorId: cell.id } as AnchorEnd,
        ...stationAnchorWorld(st, cell),
      })),
    ),
    ...Object.values(transferAnchors).map((a) => ({
      end: { anchorId: a.id } as AnchorEnd,
      x: a.x,
      y: a.y,
    })),
  ];
  if (drawn.length === 0) return null;

  return (
    <g>
      {drawn.map(({ end, x, y }) => {
        const key = anchorKey(end);
        // Free anchors are the selectable/draggable ones; a hosted anchor's id
        // is meaningless to the selection, which only knows doc.transferAnchors.
        const freeId = isHosted(end) ? null : end.anchorId;
        const selected = freeId !== null && selectedIds.includes(freeId);
        const live = freeId !== null ? freeLive : picking;
        // Already-selected anchors carry the full ring; a 50% copy on top would
        // only double the ink (the hoveredChrome rule, applied locally).
        const hovered = picking && live && hoveredKey === key && !selected;
        return (
          <g
            key={key}
            // Free anchors carry the id the selection/hit-stack keys off.
            data-anchor-id={freeId ?? undefined}
            // Hosted ones carry their (station, cell) pair instead — they are
            // never selected, but they ARE clickable as a transfer endpoint, so
            // they need an identity the DOM can be queried by.
            data-anchor-station={isHosted(end) ? end.stationId : undefined}
            data-anchor-cell={isHosted(end) ? end.anchorId : undefined}
          >
            {/* Selection ring, when armed. Decorative only: pointerEvents none,
                so it never shadows the disc's own entry in the hit stack. */}
            {selected &&
              selectionOutlineTones(theme).map(({ tone, stroke, strokeWidth }) => (
                <circle
                  key={`sel-${tone}`}
                  data-sel-tone={tone}
                  cx={x}
                  cy={y}
                  r={r + SELECTION_OUTLINE_PAD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  // Screen-constant weight with no zoom math, so the ring
                  // tracks an in-flight pan instead of snapping on commit.
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ))}
            {/* Hover affordance: the SAME two-tone ring the selection uses, at
                half opacity — "you can click this". Two tones because a single
                color vanishes against one canvas or the other; the pair flips
                with the theme (selectionOutlineTones), so it reads on both. */}
            {hovered && (
              <g opacity={0.5}>
                {selectionOutlineTones(theme).map(({ tone, stroke, strokeWidth }) => (
                  <circle
                    key={`hov-${tone}`}
                    data-anchor-hover={tone}
                    cx={x}
                    cy={y}
                    r={r + SELECTION_OUTLINE_PAD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ))}
              </g>
            )}
            {/* The disc is the single hit target for this anchor. Marked so
                hit-testing and tests can name it unambiguously — the anchor
                MARK drawn below also contains a <circle> (its ring). */}
            <circle
              data-anchor-disc="1"
              cx={x}
              cy={y}
              r={r}
              fill={theme.canvasBg}
              fillOpacity={0.85}
              stroke={theme.selectionStroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents={live ? 'all' : 'none'}
              style={live ? { cursor: freeId !== null ? 'move' : 'pointer' } : undefined}
              onPointerDown={live && freeId !== null ? (e) => onPointerDown(freeId, e) : undefined}
              onClick={live ? (e) => onClick(end, e) : undefined}
              onPointerOver={live ? () => onHover(key) : undefined}
              onPointerOut={live ? () => onHover(null) : undefined}
            />
            <g
              transform={`translate(${x - r} ${y - r}) scale(${scale})`}
              color={theme.selectionStroke}
              pointerEvents="none"
            >
              <AnchorMark strokeWidth={1.6} />
            </g>
          </g>
        );
      })}
    </g>
  );
}
