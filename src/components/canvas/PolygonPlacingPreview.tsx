import type { Vec2 } from '../../geometry/vec';
import {
  POLYGON_FILL_DEFAULT,
  POLYGON_STROKE_DEFAULT,
  POLYGON_STROKE_WIDTH_DEFAULT,
  starterPolygonVertices,
} from '../../model/transforms';

interface Props {
  world: Vec2 | null;
}

// Ghost of the starter (default-square) polygon that follows the cursor while
// in creating-polygon mode, so the user sees where (and how big) the next
// polygon will drop. Mirrors the station/label placing ghosts: semitransparent
// and pointer-transparent. Uses the same `starterPolygonVertices` as
// `addPolygon`, so the preview matches the placed shape exactly.
export function PolygonPlacingPreview({ world }: Props) {
  if (!world) return null;
  const points = starterPolygonVertices(world.x, world.y)
    .map((v) => `${v.x},${v.y}`)
    .join(' ');
  return (
    <g pointerEvents="none" opacity={0.5} data-polygon-preview="">
      <polygon
        points={points}
        fill={POLYGON_FILL_DEFAULT}
        stroke={POLYGON_STROKE_DEFAULT}
        strokeWidth={POLYGON_STROKE_WIDTH_DEFAULT}
        strokeLinejoin="round"
      />
    </g>
  );
}
