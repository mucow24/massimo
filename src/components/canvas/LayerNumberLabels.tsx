import { useMemo } from 'react';
import type { Line, LineId } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';
import { pickLayerLabelT } from '../../geometry/layerLabelPlacement';
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
 * outward when the default spot is covered by another band's stripe. The
 * per-stripe `t` is memoized against `bands` + `lines` so hover changes
 * (which only change `hovered`) don't re-run the O(stripes × candidates ×
 * other-stripes) search on every pointer move — a real perf trap before
 * memoization.
 *
 * Text fill picks black or white against the line's color via
 * {@link legibleTextOn}, so the number stays legible on any brand color.
 */
export function LayerNumberLabels({ bands, lines, hovered }: Props) {
  // Pre-compute t for every stripe whose layer is non-zero. The hovered
  // stripe at layer 0 falls through to an inline compute below — rare and
  // cheap (one pickLayerLabelT per hover change, not one per labeled stripe).
  const tByKey = useMemo(() => {
    const out = new Map<string, number>();
    for (const band of bands) {
      for (let k = 0; k < band.lines.length; k++) {
        const stripeLine = band.lines[k];
        const line = lines[stripeLine.id];
        if (!line) continue;
        const layer = line.segmentLayers?.[band.pairKey] ?? 0;
        if (layer === 0) continue;
        out.set(band.bandKey + '|' + stripeLine.id, pickLayerLabelT(band, k, bands));
      }
    }
    return out;
  }, [bands, lines]);

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
          // Memo hit for any labeled stripe whose layer was non-zero on the
          // last `bands` / `lines` snapshot; miss only for the hovered
          // layer-0 stripe (computed inline, one call per hover change).
          const t = tByKey.get(cacheKey) ?? pickLayerLabelT(band, k, bands);
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
