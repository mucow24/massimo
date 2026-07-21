import { memo } from 'react';
import type { LineId } from '../../model/types';
import type { Ring } from '../../geometry/clip';
import { subtract, unionAll } from '../../geometry/clip';
import { polygonsToPath } from '../../geometry/polygonUnion';
import { CLIP_RASTER_INVERSE_TRANSFORM, CLIP_RASTER_SCALE } from './clipRaster';

export const regionExcludeClipId = (lineId: LineId): string =>
  `region-exclude-${lineId.replace(/[^A-Za-z0-9_-]/g, '-')}`;

const scaleRings = (rings: Ring[], k: number): Ring[] =>
  rings.map((r) => r.map((p) => ({ x: p.x * k, y: p.y * k })));

export interface RegionExcludeClipsProps {
  /** lineId → exclusion hole rings (see buildExclusionHoles). */
  holes: Map<LineId, Ring[]>;
  /** World AABB the clips must PASS — the padded extent of everything the
   *  clipped lines paint (see regionClipBounds). Deliberately TIGHT: the
   *  outer ring was historically a ±500000 constant, and coordinates that
   *  large lose float precision in GPU clip rasterization at deep zoom,
   *  shifting the hole edges by visible pixels — white notches wherever an
   *  interline gap exposes a hole edge over bare background. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * One clipPath per line that loses an overridden region: the whole content
 * extent minus its exclusion holes. Applied to that line's base renderables,
 * so the region's winner shows through as its original, never-repainted
 * stroke — clipPath (not mask) so PDF export keeps it, and clipped areas
 * also stop receiving pointer events, which is what makes idle clicks land
 * on the visible winner.
 */
export const RegionExcludeClips = memo(function RegionExcludeClips({
  holes,
  bounds,
}: RegionExcludeClipsProps) {
  if (!holes.size) return null;
  const world: Ring = [
    { x: bounds.x0, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y1 },
    { x: bounds.x0, y: bounds.y1 },
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
          <path
            d={polygonsToPath(scaleRings(subtract([world], unionAll(rings)), CLIP_RASTER_SCALE))}
            transform={CLIP_RASTER_INVERSE_TRANSFORM}
            clipRule="nonzero"
          />
        </clipPath>
      ))}
    </>
  );
});
