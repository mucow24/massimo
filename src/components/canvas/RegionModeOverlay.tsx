import { memo } from 'react';
import { useViewportStore } from '../../state/viewportStore';
import { themeColors } from '../../state/theme';
import type { RegionFace } from '../../geometry/lineRegions';
import { polygonsToPath } from '../../geometry/polygonUnion';

export interface RegionModeOverlayProps {
  faces: RegionFace[];
  hoveredKey: string | null;
  /**
   * 'outlines' — the always-on dashed footprint of every clickable overlap
   * face, mounted mid-stack (below transfers/dots) like the old layering
   * outlines. 'hit' — the hover halo plus the invisible click targets,
   * mounted near the top of the SVG so face clicks win over everything.
   */
  layer: 'outlines' | 'hit';
  onHover?: (key: string | null) => void;
  onFaceClick?: (faceIndex: number, dir: 1 | -1) => void;
}

/**
 * Layering-mode chrome for region painting: dashed outlines mark every
 * clickable overlap face; hovering halos one; clicking cycles which covering
 * line paints it (handled by the owner via onFaceClick). Export-excluded by
 * the mount site. Strokes use non-scaling-stroke so they read at any zoom.
 */
export const RegionModeOverlay = memo(function RegionModeOverlay({
  faces,
  hoveredKey,
  layer,
  onHover,
  onFaceClick,
}: RegionModeOverlayProps) {
  const darkMode = useViewportStore((s) => s.darkMode);
  const theme = themeColors(darkMode);
  if (layer === 'outlines') {
    return (
      <g pointerEvents="none">
        {faces.map((f) =>
          f.key === hoveredKey ? null : (
            <path
              key={f.key}
              data-region-outline="1"
              data-region-key={f.key}
              d={polygonsToPath(f.face)}
              fill="none"
              stroke={theme.label}
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          ),
        )}
      </g>
    );
  }
  return (
    <g>
      {faces.map((f, i) => {
        const d = polygonsToPath(f.face);
        return (
          <g key={f.key}>
            {f.key === hoveredKey && (
              // Two-tone halo (white core / black edge) so it contrasts any
              // body color — the selection-chrome convention.
              <g pointerEvents="none" data-region-hover-outline="1" data-region-key={f.key}>
                <path
                  d={d}
                  fill="none"
                  stroke="#000000"
                  strokeWidth={3.5}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            <path
              d={d}
              fill="none"
              data-region-target="1"
              data-region-key={f.key}
              data-line-ids={f.lineIds.join(',')}
              pointerEvents="fill"
              cursor="pointer"
              onPointerEnter={() => onHover?.(f.key)}
              onPointerLeave={() => onHover?.(null)}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick?.(i, e.shiftKey ? -1 : 1);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFaceClick?.(i, -1);
              }}
            />
          </g>
        );
      })}
    </g>
  );
});
