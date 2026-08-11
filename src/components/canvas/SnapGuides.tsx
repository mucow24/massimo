import { STOP_DOT_RADIUS } from '../../geometry/orientation';
import type { SnapGuide } from '../../geometry/snap';
import { midpoint, norm, perp, sub } from '../../geometry/vec';
import { capCenterDy } from '../../geometry/textMeasure';
import { useThemeColors } from '../../state/theme';
import { withAlpha } from '../../util/color';

interface Props {
  guides: SnapGuide[];
  zoom: number;
}

/**
 * Snap-axis guide rendering: a soft halo behind + a dashed accent line on top
 * for each active alignment axis, plus circles at the endpoints. Stroke
 * widths are inverse to zoom so the guide stays visually consistent.
 *
 * Colors derive from the theme accent — the same "the editor is helping you"
 * blue as the marquee, mode frames, and selection washes. (The old palette
 * was a one-off teal + MTA-subway-yellow measurement chip; that yellow is a
 * real line color in the NYC palette, so the chip could be pixel-identical
 * to map content.)
 */
export function SnapGuides({ guides: allGuides, zoom }: Props) {
  const themeColors = useThemeColors();
  // Alignment-guide MARKERS are not drawable segments — the engaged guide
  // itself recolors in the guides layer (GuideView reads the same array).
  const guides = allGuides.filter((g) => !g.alignGuideId);
  if (guides.length === 0) return null;
  const halo = withAlpha(themeColors.accent, 0.3);
  return (
    <g pointerEvents="none">
      <defs>
        <filter id="snap-halo-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={2 / zoom} />
        </filter>
      </defs>
      <g filter="url(#snap-halo-blur)">
        {guides.map((g, i) => (
          <g key={'halo' + i}>
            <line
              x1={g.from.x}
              y1={g.from.y}
              x2={g.to.x}
              y2={g.to.y}
              stroke={halo}
              strokeWidth={5 / zoom}
              strokeLinecap="round"
            />
            <circle
              cx={g.from.x}
              cy={g.from.y}
              r={STOP_DOT_RADIUS + 1 / zoom}
              fill="none"
              stroke={halo}
              strokeWidth={5 / zoom}
            />
            <circle
              cx={g.to.x}
              cy={g.to.y}
              r={STOP_DOT_RADIUS + 1 / zoom}
              fill="none"
              stroke={halo}
              strokeWidth={5 / zoom}
            />
          </g>
        ))}
      </g>
      {guides.map((g, i) => (
        <line
          key={'dash' + i}
          data-snap-guide=""
          x1={g.from.x}
          y1={g.from.y}
          x2={g.to.x}
          y2={g.to.y}
          stroke={themeColors.accent}
          strokeWidth={2 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        />
      ))}
      {guides.map((g, i) => {
        if (!g.label) return null;
        // Position the label above the midpoint of the guide, offset
        // perpendicular by a small fixed screen-pixel amount so it sits
        // clear of the dotted line. "Above" = the side toward smaller y
        // (screen up) — the perpendicular flips to keep the label on top
        // regardless of the line's direction.
        const { x: mx, y: my } = midpoint(g.from, g.to);
        let { x: px, y: py } = perp(norm(sub(g.to, g.from)));
        if (py > 0) {
          px = -px;
          py = -py;
        }
        const offset = 9 / zoom;
        const lx = mx + px * offset;
        const ly = my + py * offset;
        return (
          <text
            key={'label' + i}
            x={lx}
            // Cap-centered on the alphabetic baseline — NOT dominantBaseline="central",
            // which resolves from platform-specific font metrics (see capCenterDy).
            y={ly + capCenterDy(14 / zoom)}
            fontSize={14 / zoom}
            fontWeight={700}
            fill="#fff"
            stroke={themeColors.accent}
            strokeWidth={4 / zoom}
            paintOrder="stroke"
            textAnchor="middle"
            pointerEvents="none"
          >
            {g.label}
          </text>
        );
      })}
    </g>
  );
}
