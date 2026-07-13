import type { Line, LineId } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { closedPerimeterPath, computeStripeOutline } from '../../geometry/stripeOutline';
import { lineSeamColorOf } from '../../model/lineStroke';

// Clip-path id for a line's branch seam. The seam paints the casing's OUTER
// ring in the seam color, clipped to this — the union of the line's OWN body
// corridors — so it shows ONLY where the line overlaps itself (a branch/loop)
// and vanishes on the true outer boundary (where the bright casing does the
// work). Line ids can be uuids, so sanitize to valid SVG id characters.
export const seamClipId = (lineId: LineId): string =>
  `seam-clip-${lineId.replace(/[^A-Za-z0-9_-]/g, '-')}`;

interface Props {
  bands: SegmentBandSpec[];
  lines: Record<LineId, Line>;
}

/**
 * One `<clipPath>` per line that has a seam color set, tracing the UNION of
 * that line's band body corridors (each a filled closed-perimeter ribbon).
 * Mount inside the canvas `<defs>`. A `<clipPath>` (fill-based, unlike a
 * `<mask>`) is what lets the seam survive PDF export — svg2pdf drops masks but
 * renders clips (see pdfMask.ts / exportCanvasPdf.ts). Cheap: one clip per
 * seam-enabled line, each a handful of ribbon paths.
 */
export function SeamClips({ bands, lines }: Props) {
  const byLine = new Map<LineId, string[]>();
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      const lineId = band.lines[k].id;
      if (lineSeamColorOf(lines[lineId]) === undefined) continue;
      const outline = computeStripeOutline(band, k);
      if (!outline) continue;
      const d = closedPerimeterPath(outline.segsA, outline.segsB);
      if (!d) continue;
      let ribbons = byLine.get(lineId);
      if (!ribbons) {
        ribbons = [];
        byLine.set(lineId, ribbons);
      }
      ribbons.push(d);
    }
  }
  if (byLine.size === 0) return null;
  return (
    <>
      {[...byLine].map(([lineId, ribbons]) => (
        <clipPath key={lineId} id={seamClipId(lineId)} clipPathUnits="userSpaceOnUse">
          {ribbons.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      ))}
    </>
  );
}
