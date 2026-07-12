import type { Vec2 } from '../../geometry/vec';
import type { Line, Station, StationId, StationStyleProps } from '../../model/types';
import { makeStation } from '../../model/transforms';
import { defaultStyleProps } from '../../model/styles';
import { useDoc } from '../../state/store';
import { StationView } from '../StationView';

const PREVIEW_ID = '__placing_preview__' as StationId;
const NO_OP = () => {};

// The dropped station gets the designated default 'station' style stamped on
// creation (addStation → applyDefaultStyle), so the ghost carries those same
// typography values — otherwise a customized Default (bigger font, bold) would
// preview at the factory look and jump on drop.
export function makePreviewStation(world: Vec2, name: string, style?: StationStyleProps): Station {
  const station = makeStation(PREVIEW_ID, world.x, world.y, name);
  // `style` is exactly the five typography keys — spread it on so the ghost
  // renders at the default style's look (what the dropped station will get).
  return style ? { ...station, ...style } : station;
}

interface Props {
  world: Vec2 | null;
  name: string | null;
  lines: Record<string, Line>;
}

// Ghost station that follows the cursor while in station-placing mode. The
// 'label' and 'dots' StationView layers read only station.* (typography is now
// per-station), so it's safe to feed them a synthetic station that doesn't
// exist in the doc map — seeded with the default style's props so it matches
// what will actually drop.
export function StationPlacingPreview({ world, name, lines }: Props) {
  const stationStyle = useDoc((s) => defaultStyleProps(s, 'station'));
  if (!world || !name) return null;
  const station = makePreviewStation(world, name, stationStyle);
  return (
    <g pointerEvents="none" opacity={0.5} data-station-preview="">
      <StationView station={station} lines={lines} layer="label" zoom={1} onStartDrag={NO_OP} />
      <StationView station={station} lines={lines} layer="dots" zoom={1} onStartDrag={NO_OP} />
    </g>
  );
}
