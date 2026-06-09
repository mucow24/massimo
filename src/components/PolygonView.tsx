import type { Polygon } from '../model/types';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { resolvePolygonColors } from '../model/transforms';
import { polygonPathData } from '../geometry/polygon';

// Half-size of a square vertex handle, and the radius of an edge "+" button,
// authored in world units at zoom 1. The overlay divides every adornment
// dimension (and stroke) by zoom so they stay a CONSTANT size on screen at any
// zoom — keeping handles out of the way during detail work when zoomed in.
const VERTEX_HANDLE_HALF = 5;
const EDGE_ADD_R = 7;

interface Props {
  polygon: Polygon;
  // 'body' is painted under all map content; 'overlay' (selected only) is
  // painted on top so the handles + "+" buttons stay clickable.
  layer: 'body' | 'overlay';
  selected: boolean;
  // Index of the currently-selected vertex (for highlight), or null.
  selectedVertexIndex: number | null;
  // When false, the body ignores pointer events so a canvas click "falls
  // through" to placement (used while a click-to-place tool is active).
  interactive: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
  onVertexPointerDown: (id: string, index: number, e: React.PointerEvent) => void;
  onVertexClick: (id: string, index: number, e: React.MouseEvent) => void;
  // Pointer-down on an edge "+" inserts the midpoint vertex and immediately
  // begins dragging it (a plain click leaves it at the midpoint).
  onEdgeAddPointerDown: (id: string, edgeIndex: number, e: React.PointerEvent) => void;
}

const pointsAttr = (vertices: Polygon['vertices']) =>
  vertices.map((v) => `${v.x},${v.y}`).join(' ');

export function PolygonView({
  polygon,
  layer,
  selected,
  selectedVertexIndex,
  interactive,
  onPointerDown,
  onClick,
  onContextMenu,
  onVertexPointerDown,
  onVertexClick,
  onEdgeAddPointerDown,
}: Props) {
  const themeColors = useThemeColors();
  const darkMode = useViewportStore((s) => s.darkMode);
  const zoom = useViewportStore((s) => s.zoom);
  // The body paints the dark colors in dark mode, the light colors otherwise.
  const { fill, stroke } = resolvePolygonColors(polygon, darkMode);
  // Adornment colors flip with the theme: marks drawn ON the selection-colored
  // disc/handle use the canvas background so they stay legible in both modes
  // (selectionStroke is black on light, white on dark).
  const accent = themeColors.selectionStroke;
  const contrast = themeColors.canvasBg;
  const verts = polygon.vertices;
  const n = verts.length;
  const closed = polygon.closed !== false;

  if (layer === 'body') {
    // A single <path> handles both sharp and rounded corners: radius 0 yields a
    // straight M/L/…/Z, identical to a <polygon>. Export clones this live DOM, so
    // the rounded shape carries into PNG/SVG for free. An OPEN polygon renders
    // stroke-only along the vertex chain (no fill, no closing edge), with hit
    // testing on the stroke (pointerEvents="stroke", matching TransferLayer).
    return (
      <path
        data-polygon-id={polygon.id}
        data-polygon-selected={selected || undefined}
        data-polygon-locked={polygon.locked || undefined}
        data-polygon-open={!closed || undefined}
        d={polygonPathData(verts, polygon.curveRadius ?? 0, closed)}
        fill={closed ? fill : 'none'}
        fillOpacity={closed ? (polygon.fillOpacity ?? 100) / 100 : undefined}
        stroke={stroke}
        strokeWidth={polygon.strokeWidth}
        // strokeWidth 0 already hides the stroke; linejoin keeps thin corners clean.
        strokeLinejoin="round"
        // Round caps so an open chain's loose ends match its rounded joins.
        strokeLinecap={closed ? undefined : 'round'}
        // Ignore pointer events while a placement tool is active so the click
        // reaches the canvas and places the item over the polygon.
        pointerEvents={interactive ? (closed ? undefined : 'stroke') : 'none'}
        onPointerDown={(e) => onPointerDown(polygon.id, e)}
        onClick={(e) => onClick(polygon.id, e)}
        onContextMenu={(e) => onContextMenu(polygon.id, e)}
        style={{ cursor: 'pointer' }}
      />
    );
  }

  // Overlay: dashed outline + an edge "+" at each midpoint + a handle at each
  // vertex. Rendered only when selected.
  if (!selected) return null;
  // Inverse-zoom scale: every adornment dimension and stroke is multiplied by
  // `s` so it renders at a constant screen size regardless of zoom (matches the
  // `1 / zoom` idiom in Grid.tsx). Hit-testing IS the rendered element, so the
  // clickable area stays constant on screen too.
  const s = 1 / zoom;
  const half = VERTEX_HANDLE_HALF * s;
  const r = EDGE_ADD_R * s;
  // An open polygon's dashed outline and edge "+" buttons skip the closing
  // edge — there is nothing to select or split between the two loose ends.
  const Outline = closed ? 'polygon' : 'polyline';
  const edgeIndices = Array.from({ length: closed ? n : n - 1 }, (_, i) => i);
  return (
    <g data-polygon-overlay={polygon.id}>
      <Outline
        points={pointsAttr(verts)}
        fill="none"
        stroke={accent}
        strokeWidth={1.5 * s}
        strokeDasharray={`${4 * s} ${3 * s}`}
        pointerEvents="none"
      />
      {/* A locked polygon shows only the selection outline — no editing
          adornments (vertex handles, edge "+") — but stays selected so the
          popover's unlock toggle is reachable. */}
      {!polygon.locked && (
        <>
          {edgeIndices.map((i) => {
            const v = verts[i];
            const next = verts[(i + 1) % n];
            const mx = (v.x + next.x) / 2;
            const my = (v.y + next.y) / 2;
            return (
              <g
                key={`edge-${i}`}
                data-polygon-edge-add={i}
                onPointerDown={(e) => onEdgeAddPointerDown(polygon.id, i, e)}
                style={{ cursor: 'copy' }}
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
              fill={i === selectedVertexIndex ? accent : contrast}
              stroke={accent}
              strokeWidth={1.5 * s}
              onPointerDown={(e) => onVertexPointerDown(polygon.id, i, e)}
              onClick={(e) => onVertexClick(polygon.id, i, e)}
              style={{ cursor: 'move' }}
            />
          ))}
        </>
      )}
    </g>
  );
}
