import { useMemo } from 'react';
import type { Line, LineId } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';
import { pickLayerLabelT, sampleBandStripes } from '../../geometry/layerLabelPlacement';
import { STOP_SIZE } from '../../geometry/orientation';
import { legibleTextOn } from '../../util/color';

const FONT_SIZE = 9;
const FONT_WEIGHT = 700;

interface Props {
  bands: SegmentBandSpec[];
  lines: Record<LineId, Line>;
  hovered: { bandKey: string; lineId: LineId } | null;
}

/**
 * Layering-mode label overlay: a small layer-number label on every band
 * stripe whose layer is non-zero, plus the currently-hovered stripe — which
 * shows even when layer is 0 so the user can tell what they're about to
 * cycle from.
 *
 * Each label's arc-length position along its stripe is chosen by
 * {@link pickLayerLabelT}, which biases toward the midpoint but walks
 * outward when the default spot is covered by another band's stripe.
 *
 * Performance: both the sampled-stripes cache and the per-stripe `t` table
 * memoize on the `bands` reference. The caller is expected to pass the
 * geometric-only bands array (split out of `buildBands` so layer cycles
 * don't change its reference), which keeps the t-search from re-running
 * on every layer click. Without that split a single click on a busy map
 * burnt 300-500ms.
 *
 * Text fill picks black or white against the line's color via
 * {@link legibleTextOn}, so the number stays legible on any brand color.
 */
export function LayerNumberLabels({ bands, lines, hovered }: Props) {
  // Pre-sample every stripe so distance queries inside pickLayerLabelT skip
  // the per-call `emitOffsetSegments` cost. Stable across layer cycles
  // because `bands` is the geometry-only array from MapCanvas.
  const sampledStripes = useMemo(() => sampleBandStripes(bands), [bands]);

  // Pre-compute t for every stripe of every band. We compute for stripes
  // at layer 0 too so a hover-into-a-layer-0 stripe doesn't fall off the
  // cache (and the hover thrashes the search). pickLayerLabelT depends only
  // on geometry, not on segmentLayers, so the table is stable across layer
  // cycles too.
  const tByKey = useMemo(() => {
    const out = new Map<string, number>();
    for (const band of bands) {
      for (let k = 0; k < band.lines.length; k++) {
        const stripeLine = band.lines[k];
        out.set(
          band.bandKey + '|' + stripeLine.id,
          pickLayerLabelT(band, k, bands, sampledStripes),
        );
      }
    }
    return out;
  }, [bands, sampledStripes]);

  return (
    <>
      {bands.flatMap((band) =>
        band.lines.map((stripeLine, k) => {
          const line = lines[stripeLine.id];
          if (!line) return null;
          const layer = line.segmentLayers?.[band.pairKey] ?? 0;
          const isHovered =
            !!hovered && hovered.bandKey === band.bandKey && hovered.lineId === stripeLine.id;
          if (layer === 0 && !isHovered) return null;
          const n = band.lines.length;
          const offset = (k - (n - 1) / 2) * STOP_SIZE;
          const cacheKey = band.bandKey + '|' + stripeLine.id;
          // Cache covers every stripe on the current geometry — the lookup
          // is a guaranteed hit. The `?? 0.5` fallback is only there to
          // keep TypeScript happy about Map.get's nullable return.
          const t = tByKey.get(cacheKey) ?? 0.5;
          const at = sampleOffsetPath(band.centerline, band.radius, offset, t);
          const label = formatLayer(layer);
          const textColor = legibleTextOn(stripeLine.color);
          return (
            <text
              key={'layer:' + band.bandKey + ':' + stripeLine.id}
              data-layer-number
              data-band-key={band.bandKey}
              data-line-id={stripeLine.id}
              data-layer={layer}
              x={at.p.x}
              y={at.p.y}
              fontSize={FONT_SIZE}
              fontWeight={FONT_WEIGHT}
              fill={textColor}
              textAnchor="middle"
              dominantBaseline="central"
              pointerEvents="none"
              style={{ userSelect: 'none' }}
            >
              {label}
            </text>
          );
        }),
      )}
    </>
  );
}

function formatLayer(layer: number): string {
  if (layer === 0) return '0';
  if (layer > 0) return `+${layer}`;
  return `${layer}`;
}
