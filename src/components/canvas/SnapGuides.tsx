import { STOP_DOT_RADIUS } from '../../geometry/orientation';
import { guideSegmentInBox, type SnapGuide } from '../../geometry/snap';
import { midpoint, norm, perp, sub } from '../../geometry/vec';
import type { Vec2 } from '../../geometry/vec';
import { capCenterDy } from '../../geometry/textMeasure';
import { useThemeColors } from '../../state/theme';
import { withAlpha } from '../../util/color';
import type { GuideOrientation } from '../../model/types';

/** An alignment guide some drag or placement is snapped AGAINST right now,
 *  plus the landed reference point of the drag that engaged it. */
export interface EngagedGuideChrome {
  id: string;
  orientation: GuideOrientation;
  offset: number;
  at: Vec2;
}

interface Props {
  guides: SnapGuide[];
  zoom: number;
  /** Engaged alignment guides. Rendered with the SAME chrome as any other
   *  snap — halo + dashed accent spanning `vb`, a ring at the snap point, and
   *  a chip naming what was snapped to (the guide's coordinate: there is no
   *  target-distance to measure when the point is ON the line). */
  engaged?: EngagedGuideChrome[];
  /** The overdrawn box an engaged guide's chrome spans (present with
   *  `engaged`) — the same slack the guides layer itself paints with, so a
   *  mid-gesture camera can't reveal an end. */
  vb?: { vbX: number; vbY: number; vbW: number; vbH: number };
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
 *
 * Alignment-guide MARKER entries (`alignGuideId`) are never drawn as segments
 * — the engaged guide itself gets the chrome, via `engaged`, so the feedback
 * lands on the object the user snapped to instead of a second line over it.
 */
export function SnapGuides({ guides: allGuides, zoom, engaged, vb }: Props) {
  const themeColors = useThemeColors();
  const guides = allGuides.filter((g) => !g.alignGuideId);
  const engagedGuides = engaged && vb ? engaged : [];
  if (guides.length === 0 && engagedGuides.length === 0) return null;
  const halo = withAlpha(themeColors.accent, 0.3);
  // An engaged guide's span across the overdrawn box, along its axis — the
  // same clipped segment the guide itself paints with (GuideView). An
  // engaged guide is under the cursor, so the box always catches it.
  const spanOf = (g: EngagedGuideChrome) =>
    guideSegmentInBox(g.orientation, g.offset, vb!.vbX, vb!.vbY, vb!.vbW, vb!.vbH);
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
        {engagedGuides.map((g) => {
          const s = spanOf(g);
          if (!s) return null;
          return (
            <g key={'ehalo' + g.id}>
              <line {...s} stroke={halo} strokeWidth={5 / zoom} strokeLinecap="round" />
              <circle
                cx={g.at.x}
                cy={g.at.y}
                r={STOP_DOT_RADIUS + 1 / zoom}
                fill="none"
                stroke={halo}
                strokeWidth={5 / zoom}
              />
            </g>
          );
        })}
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
      {engagedGuides.map((g) => {
        const s = spanOf(g);
        if (!s) return null;
        return (
          <g key={'eng' + g.id} data-engaged-guide={g.id}>
            <line
              {...s}
              stroke={themeColors.accent}
              strokeWidth={2 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
            <circle
              cx={g.at.x}
              cy={g.at.y}
              r={STOP_DOT_RADIUS + 1 / zoom}
              fill="none"
              stroke={themeColors.accent}
              strokeWidth={2 / zoom}
            />
          </g>
        );
      })}
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
      {engagedGuides.map((g) => {
        // The chip names what was snapped TO — the guide's coordinate — and
        // rides the snap point so it stays by the cursor. Above the line for
        // a horizontal guide (the drawn-segment convention); beside it,
        // reading east, for a vertical one; up the perpendicular for a
        // diagonal (straight above would graze the 45° line). A diagonal's
        // coordinate is its Y-intercept, chip-named Y₀.
        const offset = 12 / zoom;
        const d = offset / Math.SQRT2;
        let lx: number;
        let ly: number;
        let anchor: 'start' | 'middle' | 'end' = 'middle';
        let name = 'Y₀';
        switch (g.orientation) {
          case 'horizontal':
            lx = g.at.x;
            ly = g.offset - offset;
            name = 'Y';
            break;
          case 'vertical':
            lx = g.offset + offset;
            ly = g.at.y;
            anchor = 'start';
            name = 'X';
            break;
          case 'diagonal-down':
            lx = g.at.x + d;
            ly = g.at.y - d;
            break;
          case 'diagonal-up':
            lx = g.at.x - d;
            ly = g.at.y - d;
            anchor = 'end';
            break;
        }
        const value = Math.round(g.offset);
        return (
          <text
            key={'elabel' + g.id}
            x={lx}
            y={ly + capCenterDy(14 / zoom)}
            fontSize={14 / zoom}
            fontWeight={700}
            fill="#fff"
            stroke={themeColors.accent}
            strokeWidth={4 / zoom}
            paintOrder="stroke"
            textAnchor={anchor}
            pointerEvents="none"
          >
            {`${name} ${value}`}
          </text>
        );
      })}
    </g>
  );
}
