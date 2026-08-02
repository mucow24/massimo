import type { Line, Station } from '../../model/types';
import { STOP_SIZE, stopCenterAt } from '../../geometry/orientation';
import type { RowCol } from '../../geometry/lattice';
import { lineWidthOf } from '../../model/lineWidth';
import { lineDisplayName } from '../../model/lineNaming';
import { useThemeColors } from '../../state/theme';
import { resolveDotSize } from '../../model/dotSize';
import { LABEL_FONT_SIZE_DEFAULT, stationIsSingleton } from '../../model/transforms';
import { capCenterDy } from '../../geometry/textMeasure';
import { OrientationArrow } from '../StationOrientationArrows';
import { AnchorMark, ANCHOR_ICON_BOX } from '../AnchorGlyph';
import type { LayoutDragSource } from './useStationLayoutDrag';

// Every handle is sized in WORLD units — geometry AND stroke weight — so it
// grows and shrinks with the map, like the station it wraps, and reads exactly
// the same at every zoom. Sizing off the COMMITTED zoom (`X / zoom`) held a
// screen size that went stale mid-gesture and snapped when the camera
// committed; holding only the WEIGHT screen-constant (vector-effect, the
// selection ring's recipe) leaves the weight fighting world-sized geometry as
// you zoom. Read the number against the ring it draws, not against a screen
// weight: 0.5 on the default r=7 ring is a fine hairline.
export const RING_WIDTH = 0.5;
// The active (selected / swap-target / drop-preview) ring reads a half-step
// heavier.
export const RING_ACTIVE_WIDTH = RING_WIDTH * 1.5;

// Arrow length as a fraction of its ring's DIAMETER. In here the arrow has to
// live inside the ring, so it takes its size from the ring — not from the dot
// like the map's hover badge, where a service-code disc (12) scaled the arrow
// past the ring it would have to fit in.
const ARROW_FIT = 0.88;

// Scrim inside each stop ring. A dot carrying the line's service code puts text
// directly under the orientation glyph, where the two compete and neither
// reads; a wash over the dot settles it in the arrow's favor.
export const RING_SCRIM = 'rgba(0, 0, 0, 0.8)';

// The editor dims the whole map behind it (see MapCanvas), so its rings read
// against a DARK backdrop in BOTH themes: a light ring for idle stops, a
// bright accent for the active/swap stop. High contrast on the dim is the
// whole point — the old thin, theme-accent (dark-blue in light mode) ring is
// exactly what the redesign replaces.
const LAYOUT_RING = 'rgba(255, 255, 255, 0.92)';
export const LAYOUT_RING_ACTIVE = '#5b9dff';

// The node the ghost grid is projected from during a drag is painted amber
// instead of white — its own ink, no extra ring — and stays distinct from the
// blue selected/swap ring, since the projection anchor is the REFERENCE a drop
// aligns to, not the drop target. The lattice it projects wears the same
// amber (see GhostLattice), which is what ties the slots to their origin.
export const LAYOUT_RING_PROJECT = '#ffc24b';

/**
 * How a handle reads:
 * - `idle` — white ink, hairline ring.
 * - `active` — selected, swap target, or the live drop preview: blue ring, a
 *   half-step heavier.
 * - `project` — the node the ghost lattice is projected from: amber ink.
 */
export type LayoutHandleState = 'idle' | 'active' | 'project';

/**
 * One station-layout node drawn at a lattice cell: the grab ring plus the
 * node's own glyph (a stop's axis arrow, a transfer anchor's mark, the label
 * cell's "L"). Local to the station's rotated frame, so the caller supplies
 * that transform.
 *
 * Two callers, deliberately one component: the editor paints every node with
 * it, and the drop preview paints the DRAGGED node with it in the `active`
 * state — so what rides the snapped slot is exactly the node as it will land,
 * not a stand-in circle that has to be kept in sync by hand.
 */
export function LayoutNodeHandle({
  station,
  lines,
  source,
  cell,
  state,
  pointerEvents,
}: {
  station: Station;
  lines: Record<string, Line>;
  /** Which node this is — the same descriptor a drag carries. */
  source: LayoutDragSource;
  /** The cell to draw at: the node's own in the editor, the snapped slot in
   *  the drop preview. */
  cell: RowCol;
  state: LayoutHandleState;
  pointerEvents: 'none' | 'all';
}) {
  const theme = useThemeColors();
  const c = stopCenterAt(cell.row, cell.col);
  const ringWidth = state === 'active' ? RING_ACTIVE_WIDTH : RING_WIDTH;
  const ink = state === 'project' ? LAYOUT_RING_PROJECT : '#fff';
  const ringStroke =
    state === 'project'
      ? LAYOUT_RING_PROJECT
      : state === 'active'
        ? LAYOUT_RING_ACTIVE
        : LAYOUT_RING;

  if (source.kind === 'stop') {
    const stop = station.stops.find((s) => s.lineId === source.lineId);
    if (!stop) return null;
    const line = lines[source.lineId];
    // Singleton vs. shared picks the stop's split default (dot style + size).
    const isSingleton = stationIsSingleton(station);
    // The ring wraps the stop cell: half the stripe width, never inside an
    // oversized dot (same reason the shield pads by maxDotR), never below
    // the lattice cell a thin line's stop still occupies.
    const r = Math.max(
      lineWidthOf(line) / 2,
      resolveDotSize(line, stop, isSingleton) / 2,
      STOP_SIZE / 2,
    );
    return (
      <>
        {/* Native tooltip naming the line this stop serves — the shared
            user-facing line name, same as the sidebar row and the inspector
            badge. */}
        <title>{lineDisplayName(line)}</title>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill={RING_SCRIM}
          pointerEvents={pointerEvents}
          stroke={ringStroke}
          strokeWidth={ringWidth}
        />
        <OrientationArrow
          x={c.x}
          y={c.y}
          size={r * 2 * ARROW_FIT}
          orientation={stop.orientation}
          lineId={source.lineId}
          fill={ink}
          viaCircle={stop.viaCircle}
        />
      </>
    );
  }

  if (source.kind === 'anchor') {
    const r = STOP_SIZE / 2;
    return (
      <>
        <title>Transfer anchor</title>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill={RING_SCRIM}
          pointerEvents={pointerEvents}
          stroke={ringStroke}
          strokeWidth={ringWidth}
        />
        <g
          transform={`translate(${c.x - r} ${c.y - r}) scale(${(r * 2) / ANCHOR_ICON_BOX})`}
          color={ink}
          pointerEvents="none"
        >
          <AnchorMark strokeWidth={1.6} />
        </g>
      </>
    );
  }

  // Label cell. Marks the CELL anchor — the painted text may sit offset from
  // it via offset/offsetPerp/align.
  const r = STOP_SIZE / 2;
  return (
    <>
      <circle
        cx={c.x}
        cy={c.y}
        r={r}
        fill={state === 'project' ? LAYOUT_RING_PROJECT : 'rgba(255,255,255,0.65)'}
        pointerEvents={pointerEvents}
        stroke={state === 'active' ? theme.selectionStroke : 'rgba(0,0,0,0.45)'}
        strokeWidth={RING_WIDTH}
      />
      <text
        x={c.x}
        // Cap-centered on the alphabetic baseline — NOT dominantBaseline="central",
        // which resolves from platform-specific font metrics (see capCenterDy).
        y={c.y + capCenterDy(LABEL_FONT_SIZE_DEFAULT)}
        transform={`rotate(${station.label.rotation * 45} ${c.x} ${c.y})`}
        textAnchor="middle"
        fontSize={LABEL_FONT_SIZE_DEFAULT}
        fontWeight={700}
        fill="#222"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        L
      </text>
    </>
  );
}
