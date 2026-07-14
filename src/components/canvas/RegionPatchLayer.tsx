import { memo, useMemo } from 'react';
import type { Line, LineId } from '../../model/types';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../model/lineStroke';
import { lineWidthOf } from '../../model/lineWidth';
import type { OrderedRenderable, StopMarkerSpec } from '../../geometry/interlining';
import {
  buildPatchClip,
  regionDefaultWinner,
  stripeIntersectsBox,
  type RegionFace,
} from '../../geometry/lineRegions';
import { polygonsToPath } from '../../geometry/polygonUnion';
import { SegmentBand } from '../SegmentBand';
import { StopMarker } from '../StopMarker';

export const regionClipId = (faceKey: string): string =>
  `region-clip-${faceKey.replace(/[^A-Za-z0-9_-]/g, '-')}`;

export interface RegionPatchLayerProps {
  faces: RegionFace[];
  winners: { winner: LineId; assignmentId: string | null }[];
  /** The main layer's sorted renderables (patches re-emit a filtered slice). */
  renderables: OrderedRenderable[];
  lines: Record<LineId, Line>;
  lineOrder: LineId[];
  colorMap?: Record<LineId, string>;
  underlayColor: string;
  /** Same handler the base stripes use, so a click on the painted winner
   *  selects the line the user SEES. Omit to render the patches inert
   *  (region mode owns all pointer input there). */
  onLineSelect?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
}

/**
 * Region paint patches: for every overlap face whose effective winner differs
 * from its lineOrder default, re-emit the winner's band renderables clipped
 * to the face (casing rims included — see buildPatchClip). Real map paint:
 * NOT export-excluded; clipPath (not mask) so PDF export keeps it.
 */
export const RegionPatchLayer = memo(function RegionPatchLayer({
  faces,
  winners,
  renderables,
  lines,
  lineOrder,
  colorMap,
  underlayColor,
  onLineSelect,
}: RegionPatchLayerProps) {
  const patches = useMemo(() => {
    const railWOf = (lineId: LineId): number => {
      const line = lines[lineId];
      return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
    };
    const markers: StopMarkerSpec[] = [];
    for (const r of renderables) if (r.kind === 'marker') markers.push(r.spec);
    const bands = [...new Set(renderables.flatMap((r) => (r.kind === 'marker' ? [] : [r.band])))];
    const orderIdx = new Map(lineOrder.map((id, i) => [id, i]));
    const list: {
      face: RegionFace;
      winner: LineId;
      clipD: string;
      faceD: string;
      items: OrderedRenderable[];
    }[] = [];
    faces.forEach((face, i) => {
      const w = winners[i];
      if (!w || !w.assignmentId) return;
      if (w.winner === regionDefaultWinner(face, lineOrder)) return; // base already shows it
      const railW = railWOf(w.winner);
      const pad = Math.max(railW, 1);
      const items = renderables.filter((r) => {
        if (r.kind === 'marker') {
          if (r.spec.lineId !== w.winner) return false;
          const half = r.spec.width / 2 + railW;
          return (
            r.spec.cx + half >= face.bbox.x0 - pad &&
            r.spec.cx - half <= face.bbox.x1 + pad &&
            r.spec.cy + half >= face.bbox.y0 - pad &&
            r.spec.cy - half <= face.bbox.y1 + pad
          );
        }
        if (r.band.lines[r.stripeIndex].id !== w.winner) return false;
        return stripeIntersectsBox(
          r.band,
          r.stripeIndex,
          face.bbox,
          r.band.stripeWidths[r.stripeIndex] / 2 + railW + pad,
        );
      });
      const clipRings = buildPatchClip(face, w.winner, bands, markers, railWOf);
      list.push({
        face,
        winner: w.winner,
        clipD: polygonsToPath(clipRings),
        faceD: polygonsToPath(face.face),
        items,
      });
    });
    // Top-of-lineOrder winners paint LAST so overlapping rim extensions of
    // adjacent patches resolve like the base painter's algorithm would.
    list.sort(
      (a, b) =>
        (orderIdx.get(b.winner) ?? lineOrder.length) -
          (orderIdx.get(a.winner) ?? lineOrder.length) || (a.face.key < b.face.key ? -1 : 1),
    );
    return list;
  }, [faces, winners, renderables, lines, lineOrder]);

  if (!patches.length) return null;
  return (
    <g data-region-patches="1">
      <defs>
        {patches.map((p) => (
          <clipPath key={p.face.key} id={regionClipId(p.face.key)} clipPathUnits="userSpaceOnUse">
            <path d={p.clipD} clipRule="nonzero" />
          </clipPath>
        ))}
      </defs>
      {patches.map((p) => (
        <g
          key={p.face.key}
          data-region-patch="1"
          data-region-key={p.face.key}
          data-line-id={p.winner}
          clipPath={`url(#${regionClipId(p.face.key)})`}
        >
          {p.items.map((r, i) =>
            r.kind === 'marker' ? (
              <StopMarker
                key={'rp-m:' + i}
                spec={r.spec}
                effectiveColor={colorMap?.[r.spec.lineId] ?? r.spec.color}
                underlayColor={underlayColor}
                lines={lines}
              />
            ) : (
              <SegmentBand
                key={'rp-' + r.kind + ':' + i}
                decorative
                spec={r.band}
                stripeIndex={r.stripeIndex}
                pass={r.kind === 'casing' ? 'silhouette' : r.kind === 'seam' ? 'seam' : 'body'}
                lines={lines}
                colorMap={colorMap}
                underlayColor={underlayColor}
              />
            ),
          )}
          {onLineSelect && (
            <path
              d={p.faceD}
              fill="none"
              data-region-hit="1"
              data-band-stripe="1"
              data-line-id={p.winner}
              pointerEvents="fill"
              onClick={(e) => onLineSelect(p.winner, e)}
            />
          )}
        </g>
      ))}
    </g>
  );
});
