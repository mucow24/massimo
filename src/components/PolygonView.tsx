import type { Polygon } from '../model/types';
import { useThemeColors } from '../state/theme';
import { useLiveZoom, useViewportStore } from '../state/viewportStore';
import { useDoc } from '../state/store';
import { resolvePolygonColors } from '../model/transforms';
import { polygonPathData } from '../geometry/polygon';
import { midpoint } from '../geometry/vec';
import { itemCursor } from './canvas/itemCursor';
import { SELECTION_DASH, selectionOutlineTones } from './selectionStyle';

// Half-size of a square vertex handle, and the radius of an edge "+" button,
// authored in world units at zoom 1. The overlay divides every adornment
// dimension (and stroke) by zoom so they stay a CONSTANT size on screen at any
// zoom — keeping handles out of the way during detail work when zoomed in.
const VERTEX_HANDLE_HALF = 5;
const EDGE_ADD_R = 7;
// Minimum on-screen edge length (px) for the "+" insert disc — roughly 3 disc
// diameters, so a disc never crowds its neighboring vertex handles.
const EDGE_ADD_MIN_EDGE_PX = 42;
// Minimum on-screen hit-corridor width (px) for an OPEN polygon's drag proxy, so
// a thin or zero-width chain still has a grabbable stroke. Divided by zoom to
// stay constant on screen, like the overlay adornments.
const OPEN_HIT_MIN_PX = 10;

interface Props {
  polygon: Polygon;
  // 'body' is painted under all map content; 'overlay' (selected only) is
  // painted on top so the handles + "+" buttons stay clickable. 'hit' (selected
  // only) is a transparent top-z copy of the body — the selected-on-top drag
  // proxy — painted above all map content so the polygon wins pointer hits.
  layer: 'body' | 'overlay' | 'hit';
  selected: boolean;
  // Indices of the currently-selected vertices (for handle highlight). Empty
  // when no vertex is selected.
  selectedVertexIndices: ReadonlySet<number>;
  // When false, the body ignores pointer events so a canvas click "falls
  // through" to placement (used while a click-to-place tool is active).
  interactive: boolean;
  // Hand mode → grab cursor (pannable). Defaults false for non-canvas uses.
  inHandMode?: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
  onVertexPointerDown: (id: string, index: number, e: React.PointerEvent) => void;
  onVertexClick: (id: string, index: number, e: React.MouseEvent) => void;
  // Pointer-down on an edge "+" inserts the midpoint vertex and immediately
  // begins dragging it (a plain click leaves it at the midpoint).
  onEdgeAddPointerDown: (id: string, edgeIndex: number, e: React.PointerEvent) => void;
  // Canvas mouseover → preview this polygon's selection outline at 50% (see
  // MapCanvas). Only the body layer wires them; the id lets leave no-op when
  // the hover already moved on. Optional so non-canvas/proxy uses skip them.
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
}

const pointsAttr = (vertices: Polygon['vertices']) =>
  vertices.map((v) => `${v.x},${v.y}`).join(' ');

/**
 * A polygon's two-tone selection outline — black core over white underlay,
 * dashed, screen-constant via vector-effect (no zoom subscription → no snap).
 * The chrome-only half of the selection overlay, with none of the vertex /
 * edge-add manipulators: the selected polygon renders it inside its overlay,
 * and a hovered (unselected) polygon renders JUST this at 50% opacity, so the
 * mouseover preview shows the ring alone — never the handles.
 */
export function PolygonSelectionOutline({ polygon }: { polygon: Polygon }) {
  const themeColors = useThemeColors();
  const closed = polygon.closed !== false;
  // An open polygon outlines the vertex chain only (no closing edge).
  const Outline = closed ? 'polygon' : 'polyline';
  return (
    <>
      {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
        <Outline
          key={tone}
          points={pointsAttr(polygon.vertices)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={SELECTION_DASH}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

export function PolygonView({
  polygon,
  layer,
  selected,
  selectedVertexIndices,
  interactive,
  inHandMode = false,
  onPointerDown,
  onClick,
  onContextMenu,
  onVertexPointerDown,
  onVertexClick,
  onEdgeAddPointerDown,
  onHoverEnter,
  onHoverLeave,
}: Props) {
  const darkMode = useDoc((s) => s.darkMode);
  // Committed zoom: only the 'hit' proxy's corridor floor reads it. The
  // selection overlay's handles size off the LIVE gesture zoom instead (see
  // PolygonSelectionOverlay) so they never snap on commit.
  const zoom = useViewportStore((s) => s.zoom);
  // The body paints the dark colors in dark mode, the light colors otherwise.
  const { fill, stroke } = resolvePolygonColors(polygon, darkMode);
  const verts = polygon.vertices;
  const closed = polygon.closed !== false;

  if (layer === 'body') {
    // A single <path> handles both sharp and rounded corners: radius 0 yields a
    // straight M/L/…/Z, identical to a <polygon>. Export clones this live DOM, so
    // the rounded shape carries into PNG/SVG for free. An OPEN polygon renders
    // stroke-only along the vertex chain (no fill, no closing edge), with hit
    // testing on the stroke (pointerEvents="stroke", matching TransferLayer).
    //
    // Click-through cases: while a placement tool is active, clicks must reach
    // the canvas to place the item over the polygon; while locked AND not
    // selected, lock means "this is background — stop catching my clicks", so
    // clicks land on whatever is beneath. Selection keeps a locked body
    // clickable so the popover's unlock toggle stays reachable.
    const clickThrough = !interactive || (polygon.locked && !selected);
    return (
      <path
        data-polygon-id={polygon.id}
        data-polygon-selected={selected || undefined}
        // Generic lock marker shared with stations: the rect-select gate keys
        // off [data-locked] so a drag starting on any locked element begins a
        // marquee instead of doing nothing.
        data-locked={polygon.locked || undefined}
        data-polygon-open={!closed || undefined}
        d={polygonPathData(verts, polygon.curveRadius ?? 0, closed)}
        fill={closed ? fill : 'none'}
        stroke={stroke}
        strokeWidth={polygon.strokeWidth}
        // strokeWidth 0 already hides the stroke; linejoin keeps thin corners clean.
        strokeLinejoin="round"
        // Round caps so an open chain's loose ends match its rounded joins.
        strokeLinecap={closed ? undefined : 'round'}
        pointerEvents={clickThrough ? 'none' : closed ? undefined : 'stroke'}
        onPointerDown={(e) => onPointerDown(polygon.id, e)}
        onClick={(e) => onClick(polygon.id, e)}
        onContextMenu={(e) => onContextMenu(polygon.id, e)}
        onPointerEnter={onHoverEnter ? () => onHoverEnter(polygon.id) : undefined}
        onPointerLeave={onHoverLeave ? () => onHoverLeave(polygon.id) : undefined}
        style={{ cursor: itemCursor(inHandMode, polygon.locked) }}
      />
    );
  }

  if (layer === 'hit') {
    // Transparent, top-z drag proxy for a SELECTED polygon: re-asserts the
    // body's exact grab footprint above all map content so the selected polygon
    // wins pointer hit-testing over anything stacked on top of it. Routes to the
    // same body handlers, so drag/click/rotate behavior is identical — only the
    // z-order of the hit target changes. Skipped while locked (not draggable) or
    // non-interactive (a placement tool is active, so clicks must fall through).
    // Carries data-polygon-hit (never data-polygon-id) so it doesn't perturb the
    // body's id-keyed document-order / strict-mode locators.
    if (!selected || polygon.locked || !interactive) return null;
    // Closed: fill-hit the whole interior PLUS the stroke band (a transparent
    // stroke of the body's width, so the outer rim — grabbable on the body —
    // stays grabbable on the proxy). Open: hit along the stroke like the body,
    // but floor the corridor so a thin/zero-width chain stays grabbable.
    const hitStroke = closed
      ? polygon.strokeWidth
      : Math.max(polygon.strokeWidth, OPEN_HIT_MIN_PX / zoom);
    return (
      <path
        data-polygon-hit={polygon.id}
        d={polygonPathData(verts, polygon.curveRadius ?? 0, closed)}
        fill={closed ? 'transparent' : 'none'}
        stroke="transparent"
        strokeWidth={hitStroke}
        strokeLinejoin="round"
        strokeLinecap={closed ? undefined : 'round'}
        pointerEvents={closed ? 'all' : 'stroke'}
        onPointerDown={(e) => onPointerDown(polygon.id, e)}
        onClick={(e) => onClick(polygon.id, e)}
        onContextMenu={(e) => onContextMenu(polygon.id, e)}
        style={{ cursor: itemCursor(inHandMode, polygon.locked) }}
      />
    );
  }

  // Overlay: two-tone selection outline + an edge "+" at each midpoint + a
  // handle at each vertex. Rendered only when selected, in its own component so
  // it — and only it — subscribes to the live gesture zoom.
  if (!selected) return null;
  return (
    <PolygonSelectionOverlay
      polygon={polygon}
      selectedVertexIndices={selectedVertexIndices}
      onVertexPointerDown={onVertexPointerDown}
      onVertexClick={onVertexClick}
      onEdgeAddPointerDown={onEdgeAddPointerDown}
    />
  );
}

/**
 * The selected polygon's editing overlay: the two-tone selection outline plus a
 * vertex handle at each corner and an edge "+" at each midpoint.
 *
 * Sizes every handle off the LIVE gesture zoom (useLiveZoom), not the committed
 * zoom, so the handles stay a constant screen size AND track a pan/zoom in
 * flight instead of snapping when it commits — the outline gets the same
 * screen-constancy for free from vector-effect. Only the selected polygon
 * mounts this, so the per-frame re-render during a gesture is a single item,
 * not the whole canvas.
 */
function PolygonSelectionOverlay({
  polygon,
  selectedVertexIndices,
  onVertexPointerDown,
  onVertexClick,
  onEdgeAddPointerDown,
}: Pick<
  Props,
  | 'polygon'
  | 'selectedVertexIndices'
  | 'onVertexPointerDown'
  | 'onVertexClick'
  | 'onEdgeAddPointerDown'
>) {
  const themeColors = useThemeColors();
  const zoom = useLiveZoom();
  // Adornment colors flip with the theme: marks drawn ON the selection-colored
  // disc/handle use the canvas background so they stay legible in both modes
  // (selectionStroke is black on light, white on dark).
  const accent = themeColors.selectionStroke;
  const contrast = themeColors.canvasBg;
  const verts = polygon.vertices;
  const n = verts.length;
  // Inverse-zoom scale: every adornment dimension and stroke is multiplied by
  // `s` so it renders at a constant screen size regardless of zoom. Hit-testing
  // IS the rendered element, so the clickable area stays constant on screen too.
  const s = 1 / zoom;
  const half = VERTEX_HANDLE_HALF * s;
  const r = EDGE_ADD_R * s;
  // An open polygon's edge "+" buttons skip the closing edge — there is nothing
  // to split between the two loose ends.
  const closed = polygon.closed !== false;
  const edgeIndices = Array.from({ length: closed ? n : n - 1 }, (_, i) => i);
  return (
    <g data-polygon-overlay={polygon.id}>
      {/* The selection outline (chrome only — no manipulators). Shared with the
          hovered-polygon preview, which renders JUST this at 50% opacity. */}
      <PolygonSelectionOutline polygon={polygon} />
      {/* Editing adornments (vertex handles, edge "+"). On a LOCKED polygon
          they render GHOSTED — still visible, so a re-selected locked polygon
          reads as selected (the thin outline alone is easy to miss) — but
          inert: reduced opacity, no pointer events, no cursors. */}
      <g
        data-polygon-adornments={polygon.locked ? 'inactive' : 'active'}
        opacity={polygon.locked ? 0.4 : undefined}
        pointerEvents={polygon.locked ? 'none' : undefined}
      >
        <>
          {edgeIndices.map((i) => {
            const v = verts[i];
            const next = verts[(i + 1) % n];
            // Density gate: skip the "+" disc on edges too short on screen to
            // host it — a detailed traced shape (30-50 vertices) otherwise
            // disappears under a chain of overlapping discs when zoomed out.
            // The discs come back as you zoom in to where inserting a vertex
            // is plausible; vertex handles (the primary manipulators) stay.
            if (Math.hypot(next.x - v.x, next.y - v.y) * zoom < EDGE_ADD_MIN_EDGE_PX) return null;
            const { x: mx, y: my } = midpoint(v, next);
            return (
              <g
                key={`edge-${i}`}
                data-polygon-edge-add={i}
                onPointerDown={(e) => onEdgeAddPointerDown(polygon.id, i, e)}
                style={{ cursor: 'crosshair' }}
              >
                <circle cx={mx} cy={my} r={r} fill={accent} stroke={contrast} strokeWidth={1 * s} />
                <line
                  x1={mx - r / 2}
                  y1={my}
                  x2={mx + r / 2}
                  y2={my}
                  stroke={contrast}
                  strokeWidth={1.5 * s}
                  pointerEvents="none"
                />
                <line
                  x1={mx}
                  y1={my - r / 2}
                  x2={mx}
                  y2={my + r / 2}
                  stroke={contrast}
                  strokeWidth={1.5 * s}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {verts.map((v, i) => (
            <rect
              key={`vert-${i}`}
              data-polygon-vertex={i}
              x={v.x - half}
              y={v.y - half}
              width={half * 2}
              height={half * 2}
              fill={selectedVertexIndices.has(i) ? accent : contrast}
              stroke={accent}
              strokeWidth={1.5 * s}
              onPointerDown={(e) => onVertexPointerDown(polygon.id, i, e)}
              onClick={(e) => onVertexClick(polygon.id, i, e)}
              style={{ cursor: 'move' }}
            />
          ))}
        </>
      </g>
    </g>
  );
}
