import type { Vec2 } from '../../geometry/vec';
import type { PolygonStyleProps } from '../../model/types';
import {
  POLYGON_FILL_DEFAULT,
  POLYGON_STROKE_DEFAULT,
  POLYGON_STROKE_WIDTH_DEFAULT,
  starterPolygonVertices,
} from '../../model/transforms';

interface Props {
  world: Vec2 | null;
  // The doc's "Default" polygon style, when one exists — the dropped polygon
  // will be stamped with it, so the ghost paints with its fill/stroke (the
  // rounding/closed props are skipped: a 50%-opacity square reads fine).
  style?: PolygonStyleProps;
}

// Ghost of the starter (default-square) polygon that follows the cursor while
// in creating-polygon mode, so the user sees where (and how big) the next
// polygon will drop. Mirrors the station/label placing ghosts: semitransparent
// and pointer-transparent. Uses the same `starterPolygonVertices` as
// `addPolygon`, so the preview matches the placed shape exactly.
export function PolygonPlacingPreview({ world, style }: Props) {
  if (!world) return null;
  const points = starterPolygonVertices(world.x, world.y)
    .map((v) => `${v.x},${v.y}`)
    .join(' ');
  return (
    <g pointerEvents="none" opacity={0.5} data-polygon-preview="">
      <polygon
        points={points}
        fill={style?.fill ?? POLYGON_FILL_DEFAULT}
        stroke={style?.stroke ?? POLYGON_STROKE_DEFAULT}
        strokeWidth={style?.strokeWidth ?? POLYGON_STROKE_WIDTH_DEFAULT}
        strokeLinejoin="round"
      />
    </g>
  );
}
