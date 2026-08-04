import type { Line, LineId } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import type { OffsetPathSegment } from '../../geometry/router';
import { closedPerimeterPath, computeStripeOutline } from '../../geometry/stripeOutline';
import { lineSeamColorStored } from '../../model/lineStroke';
import { CLIP_RASTER_INVERSE_TRANSFORM, CLIP_RASTER_SCALE } from './clipRaster';

// Scale an offset-segment chain into ×CLIP_RASTER_SCALE clip-local space (see
// clipRaster.ts): unit directions and angles are scale-invariant, all lengths
// scale.
const scaleSegs = (segs: OffsetPathSegment[], k: number): OffsetPathSegment[] =>
  segs.map((s) => {
    const from = { x: s.from.x * k, y: s.from.y * k };
    const to = { x: s.to.x * k, y: s.to.y * k };
    return s.kind === 'line'
      ? { ...s, from, to, length: s.length * k }
      : { ...s, from, to, r: s.r * k, length: s.length * k };
  });

// Clip-path id for one band's branch seam on a given line. The seam paints the
// casing rails (centered on the body edges) in the seam color, clipped to
// this — the union of the line's OTHER band corridors — so it shows ONLY where
// this band overlaps another of the line's OWN bands (a branch/loop) and
// vanishes on a plain segment (its own corridor is excluded) and on the outer
// boundary (background is excluded). Ids sanitize to valid SVG id characters.
export const seamClipId = (lineId: LineId, bandKey: string): string =>
  `seam-clip-${`${lineId}__${bandKey}`.replace(/[^A-Za-z0-9_-]/g, '-')}`;

interface Props {
  bands: SegmentBandSpec[];
  lines: Record<LineId, Line>;
}

/**
 * One `<clipPath>` per (seam line, band): the union of that line's OTHER band
 * body corridors (filled ribbons). Mount inside the canvas `<defs>`. A
 * `<clipPath>` (fill-based, unlike a `<mask>`) survives PDF export — svg2pdf
 * drops masks but renders clips. Excluding the seam's OWN band is what centers
 * the seam on the body edge (aligned with the casing) without leaking onto
 * plain segments. Cost is ~O(bands²) per seam line, but bands-per-line is small.
 */
export function SeamClips({ bands, lines }: Props) {
  // Group each seam-line's stripes with their precomputed body ribbon.
  const byLine = new Map<LineId, Array<{ bandKey: string; ribbon: string }>>();
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      const lineId = band.lines[k].id;
      // Existence only — a 'line' sentinel is a seam like any other, so the
      // stored value (not the resolved paint) is the right thing to test.
      if (lineSeamColorStored(lines[lineId]) === undefined) continue;
      const outline = computeStripeOutline(band, k);
      if (!outline) continue;
      // Emit the ribbon in ×CLIP_RASTER_SCALE clip-local coordinates so
      // Blink's ~1-local-unit clip rasterization snap (see clipRaster.ts)
      // can't visibly shift the corridor edges.
      const ribbon = closedPerimeterPath(
        scaleSegs(outline.segsA, CLIP_RASTER_SCALE),
        scaleSegs(outline.segsB, CLIP_RASTER_SCALE),
      );
      if (!ribbon) continue;
      let arr = byLine.get(lineId);
      if (!arr) {
        arr = [];
        byLine.set(lineId, arr);
      }
      arr.push({ bandKey: band.bandKey, ribbon });
    }
  }
  if (byLine.size === 0) return null;
  return (
    <>
      {[...byLine].flatMap(([lineId, stripes]) =>
        stripes.map((s, i) => {
          const others = stripes.filter((_, j) => j !== i);
          return (
            <clipPath
              // The flatMap makes every line's clips SIBLINGS, so the key needs
              // the line too — two seamed lines sharing an interlined band each
              // emit a clip for the same bandKey.
              key={lineId + ':' + s.bandKey}
              id={seamClipId(lineId, s.bandKey)}
              clipPathUnits="userSpaceOnUse"
            >
              {others.length > 0 ? (
                others.map((o, j) => (
                  <path key={j} d={o.ribbon} transform={CLIP_RASTER_INVERSE_TRANSFORM} />
                ))
              ) : (
                // No other band ⇒ no self-overlap ⇒ clip to nothing (a zero-area
                // path keeps the clipPath non-empty so it reliably hides the seam
                // rather than being treated as "no clip").
                <path d="M0 0Z" transform={CLIP_RASTER_INVERSE_TRANSFORM} />
              )}
            </clipPath>
          );
        }),
      )}
    </>
  );
}
