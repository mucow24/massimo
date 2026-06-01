import type { Polygon } from '../model/types';
import { useThemeColors } from '../state/theme';

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
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
  onVertexPointerDown: (id: string, index: number, e: React.PointerEvent) => void;
  onVertexClick: (id: string, index: number, e: React.MouseEvent) => void;
  onEdgeAddClick: (id: string, edgeIndex: number, e: React.MouseEvent) => void;
}

const pointsAttr = (vertices: Polygon['vertices']) =>
  vertices.map((v) => `${v.x},${v.y}`).join(' ');

export function PolygonView({
  polygon,
  layer,
  selected,
  selectedVertexIndex,
  onPointerDown,
  onClick,
  onContextMenu,
  onVertexPointerDown,
  onVertexClick,
  onEdgeAddClick,
}: Props) {
  const themeColors = useThemeColors();
  const verts = polygon.vertices;
  const n = verts.length;

  if (layer === 'body') {
    return (
      <polygon
        data-polygon-id={polygon.id}
        data-polygon-selected={selected || undefined}
        points={pointsAttr(verts)}
        fill={polygon.fill}
        stroke={polygon.stroke}
        strokeWidth={polygon.strokeWidth}
        // strokeWidth 0 already hides the stroke; linejoin keeps thin corners clean.
        strokeLinejoin="round"
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
        stroke={themeColors.selectionStroke}
        strokeWidth={1.5}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
      {verts.map((v, i) => {
        const next = verts[(i + 1) % n];
        const mx = (v.x + next.x) / 2;
        const my = (v.y + next.y) / 2;
        return (
          <g
            key={`edge-${i}`}
            data-polygon-edge-add={i}
            onClick={(e) => onEdgeAddClick(polygon.id, i, e)}
            style={{ cursor: 'copy' }}
          >
            <circle
              cx={mx}
              cy={my}
              r={EDGE_ADD_R}
              fill={themeColors.selectionStroke}
              stroke="#fff"
              strokeWidth={1}
            />
            <line
              x1={mx - EDGE_ADD_R / 2}
              y1={my}
              x2={mx + EDGE_ADD_R / 2}
              y2={my}
              stroke="#fff"
              strokeWidth={1.5}
              pointerEvents="none"
            />
            <line
              x1={mx}
              y1={my - EDGE_ADD_R / 2}
              x2={mx}
              y2={my + EDGE_ADD_R / 2}
              stroke="#fff"
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
          fill={i === selectedVertexIndex ? themeColors.selectionStroke : '#fff'}
          stroke={themeColors.selectionStroke}
          strokeWidth={1.5}
          onPointerDown={(e) => onVertexPointerDown(polygon.id, i, e)}
          onClick={(e) => onVertexClick(polygon.id, i, e)}
          style={{ cursor: 'move' }}
        />
      ))}
    </g>
  );
}
