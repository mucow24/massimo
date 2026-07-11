import type { Vec2 } from '../../geometry/vec';
import type { Line, LineId, RouteBullet, RouteBulletStyleProps } from '../../model/types';
import { ROUTE_BULLET_SIZE_DEFAULT } from '../../model/transforms';
import { RouteBulletView } from '../RouteBulletView';

interface Props {
  world: Vec2 | null;
  lines: Record<LineId, Line>;
  lineOrder: LineId[];
  // The doc's "Default" bullet style, when one exists — the dropped bullet
  // will be stamped with it, so the ghost wears its shape/size too.
  style?: RouteBulletStyleProps;
}

const noop = () => {};

// Ghost of the route bullet that follows the cursor while in
// creating-route-bullet mode. Mirrors the station/label/polygon placing
// ghosts: semitransparent and pointer-transparent. Uses the same
// default-line pick as the drop (first line in z-order), so the preview's
// badge color/service matches the bullet the click will create.
export function RouteBulletPlacingPreview({ world, lines, lineOrder, style }: Props) {
  if (!world) return null;
  const lineId = lineOrder.find((id) => lines[id]) ?? null;
  const bullet: RouteBullet = {
    id: '__bullet-preview',
    x: world.x,
    y: world.y,
    rotation: 0,
    lineId,
    shape: style?.shape ?? 'circle',
    size: style?.size ?? ROUTE_BULLET_SIZE_DEFAULT,
  };
  return (
    <g pointerEvents="none" opacity={0.5} data-bullet-preview="">
      <RouteBulletView
        bullet={bullet}
        lines={lines}
        selected={false}
        onPointerDown={noop}
        onClick={noop}
        onContextMenu={noop}
      />
    </g>
  );
}
