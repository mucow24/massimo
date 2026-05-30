import type { Line, LineId } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { sampleOffsetPath } from '../../geometry/lineTagGeometry';
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
 * Layering-mode label overlay: a small layer-number label at the midpoint of
 * every band stripe whose layer is non-zero, plus the currently-hovered
 * stripe — which shows even when layer is 0 so the user can tell what
 * they're about to cycle from. Text fill picks black or white against the
 * line's color via {@link legibleTextOn}, so the number stays legible on any
 * brand color.
 */
export function LayerNumberLabels({ bands, lines, hovered }: Props) {
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
          const mid = sampleOffsetPath(band.centerline, band.radius, offset, 0.5);
          const label = formatLayer(layer);
          const textColor = legibleTextOn(stripeLine.color);
          return (
            <text
              key={'layer:' + band.bandKey + ':' + stripeLine.id}
              data-layer-number
              data-band-key={band.bandKey}
              data-line-id={stripeLine.id}
              data-layer={layer}
              x={mid.p.x}
              y={mid.p.y}
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
