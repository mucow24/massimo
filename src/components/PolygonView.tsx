import type { Polygon } from '../model/types';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { resolvePolygonColors } from '../model/transforms';

// Half-size of a square vertex handle, and the radius of an edge "+" button,
// in world units (they scale with zoom like the other selection adornments).
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
  // The body paints the dark colors in dark mode, the light colors otherwise.
  const { fill, stroke } = resolvePolygonColors(polygon, darkMode);
  // Adornment colors flip with the theme: marks drawn ON the selection-colored
  // disc/handle use the canvas background so they stay legible in both modes
  // (selectionStroke is black on light, white on dark).
  const accent = themeColors.selectionStroke;
  const contrast = themeColors.canvasBg;
  const verts = polygon.vertices;
  const n = verts.length;

  if (layer === 'body') {
    return (
      <polygon
        data-polygon-id={polygon.id}
        data-polygon-selected={selected || undefined}
        data-polygon-locked={polygon.locked || undefined}
        points={pointsAttr(verts)}
        fill={fill}
        fillOpacity={(polygon.fillOpacity ?? 100) / 100}
        stroke={stroke}
        strokeWidth={polygon.strokeWidth}
        // strokeWidth 0 already hides the stroke; linejoin keeps thin corners clean.
        strokeLinejoin="round"
        // Ignore pointer events while a placement tool is active so the click
        // reaches the canvas and places the item over the polygon.
        pointerEvents={interactive ? undefined : 'none'}
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
  return (
    <g data-polygon-overlay={polygon.id}>
      <polygon
        points={pointsAttr(verts)}
        fill="none"
        stroke={accent}
        strokeWidth={1.5}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
      {/* A locked polygon shows only the selection outline — no editing
          adornments (vertex handles, edge "+") — but stays selected so the
          popover's unlock toggle is reachable. */}
      {!polygon.locked && (
        <>
          {verts.map((v, i) => {
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
                <circle
                  cx={mx}
                  cy={my}
                  r={EDGE_ADD_R}
                  fill={accent}
                  stroke={contrast}
                  strokeWidth={1}
                />
                <line
                  x1={mx - EDGE_ADD_R / 2}
                  y1={my}
                  x2={mx + EDGE_ADD_R / 2}
                  y2={my}
                  stroke={contrast}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
                <line
                  x1={mx}
                  y1={my - EDGE_ADD_R / 2}
                  x2={mx}
                  y2={my + EDGE_ADD_R / 2}
                  stroke={contrast}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {verts.map((v, i) => (
            <rect
              key={`vert-${i}`}
              data-polygon-vertex={i}
              x={v.x - VERTEX_HANDLE_HALF}
              y={v.y - VERTEX_HANDLE_HALF}
              width={VERTEX_HANDLE_HALF * 2}
              height={VERTEX_HANDLE_HALF * 2}
              fill={i === selectedVertexIndex ? accent : contrast}
              stroke={accent}
              strokeWidth={1.5}
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
