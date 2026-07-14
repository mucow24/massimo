import { memo } from 'react';
import type { LineId } from '../../model/types';
import type { Ring } from '../../geometry/clip';
import { subtract, unionAll } from '../../geometry/clip';
import { polygonsToPath } from '../../geometry/polygonUnion';

export const regionExcludeClipId = (lineId: LineId): string =>
  `region-exclude-${lineId.replace(/[^A-Za-z0-9_-]/g, '-')}`;

// Big enough to cover any map; the clip must pass everything EXCEPT the holes.
const WORLD_EXTENT = 500000;

export interface RegionExcludeClipsProps {
  /** lineId → exclusion hole rings (see buildExclusionHoles). */
  holes: Map<LineId, Ring[]>;
}

/**
 * One clipPath per line that loses an overridden region: the whole world
 * minus its exclusion holes. Applied to that line's base renderables, so the
 * region's winner shows through as its original, never-repainted stroke —
 * clipPath (not mask) so PDF export keeps it, and clipped areas also stop
 * receiving pointer events, which is what makes idle clicks land on the
 * visible winner.
 */
export const RegionExcludeClips = memo(function RegionExcludeClips({
  holes,
}: RegionExcludeClipsProps) {
  if (!holes.size) return null;
  const world: Ring = [
    { x: -WORLD_EXTENT, y: -WORLD_EXTENT },
    { x: WORLD_EXTENT, y: -WORLD_EXTENT },
    { x: WORLD_EXTENT, y: WORLD_EXTENT },
    { x: -WORLD_EXTENT, y: WORLD_EXTENT },
  ];
  return (
    <>
      {[...holes.entries()].map(([lineId, rings]) => (
        <clipPath
          key={lineId}
          id={regionExcludeClipId(lineId)}
          clipPathUnits="userSpaceOnUse"
          data-region-exclude={lineId}
        >
          <path d={polygonsToPath(subtract([world], unionAll(rings)))} clipRule="nonzero" />
        </clipPath>
      ))}
    </>
  );
});
