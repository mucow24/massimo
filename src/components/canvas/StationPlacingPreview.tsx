import type { Vec2 } from '../../geometry/vec';
import type { Line, Station, StationId } from '../../model/types';
import { StationView } from '../StationView';

const PREVIEW_ID = '__placing_preview__' as StationId;
const NO_OP = () => {};

export function makePreviewStation(world: Vec2, name: string): Station {
  return {
    id: PREVIEW_ID,
    name,
    x: world.x,
    y: world.y,
    rotation: 0,
    stops: [],
    label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  };
}

interface Props {
  world: Vec2 | null;
  name: string | null;
  lines: Record<string, Line>;
}

// Ghost station that follows the cursor while in station-placing mode. The
// 'label' and 'dots' StationView layers are doc-agnostic — they read only
// station.* and font settings from useDoc — so it's safe to feed them a
// synthetic station that doesn't exist in the doc map.
export function StationPlacingPreview({ world, name, lines }: Props) {
  if (!world || !name) return null;
  const station = makePreviewStation(world, name);
  return (
    <g pointerEvents="none" opacity={0.5} data-station-preview="">
      <StationView station={station} lines={lines} layer="label" zoom={1} onStartDrag={NO_OP} />
      <StationView station={station} lines={lines} layer="dots" zoom={1} onStartDrag={NO_OP} />
    </g>
  );
}
