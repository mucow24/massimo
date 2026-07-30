import { canonicalLineCircleRadius } from '../../model/lineCircle';
import { capCenterDy } from '../../geometry/textMeasure';
import { useThemeColors } from '../../state/theme';
import type { Vec2 } from '../../geometry/vec';

// Chrome sizes in SCREEN px (÷ zoom at use), matching the guide ring and the
// snap-guide label so the preview reads the same at every zoom.
const CROSS_PX = 5;
const STROKE_PX = 1.25;
const DASH_PX = 5;
const LABEL_PX = 14;

/**
 * The diameter readout shown while a circle's radius is being chosen (the
 * two-click placement's second phase) or dragged (the resize knob): the same
 * white-on-accent measurement text the snap guides use, sitting just above
 * the circle's center. Shows the CANONICAL value — what the doc will actually
 * store — not the raw cursor distance, so the number never lies.
 */
export function CircleDiameterLabel({
  cx,
  cy,
  radius,
  zoom,
}: {
  cx: number;
  cy: number;
  radius: number;
  zoom: number;
}) {
  const themeColors = useThemeColors();
  const size = LABEL_PX / zoom;
  return (
    <text
      data-circle-diameter=""
      x={cx}
      // Cap-centered on the alphabetic baseline, like the snap-guide labels —
      // NOT dominantBaseline="central" (platform-dependent metrics).
      y={cy - 9 / zoom + capCenterDy(size)}
      fontSize={size}
      fontWeight={700}
      fill="#fff"
      stroke={themeColors.accent}
      strokeWidth={4 / zoom}
      paintOrder="stroke"
      textAnchor="middle"
      pointerEvents="none"
    >
      {`⌀ ${+(2 * radius).toFixed(2)}`}
    </text>
  );
}

/**
 * Two-click line-circle placement ghost. Phase 1 (no center yet): a small
 * cross marks where the click will put the CENTER. Phase 2 (center armed):
 * the dashed ring previews the circle at the cursor's distance — floored and
 * quarter-gridded exactly like the drop (canonicalLineCircleRadius) — with
 * the diameter readout above the center.
 */
export function LineCirclePlacingPreview({
  center,
  world,
  zoom,
}: {
  // The armed center (phase 2), or null while the first click is pending.
  center: Vec2 | null;
  // Cursor in world coords (already placement-snapped by MapCanvas), or null
  // when the pointer is off-canvas.
  world: Vec2 | null;
  zoom: number;
}) {
  const themeColors = useThemeColors();
  if (!center && !world) return null;
  const cross = (p: Vec2, key: string) => {
    const c = CROSS_PX / zoom;
    return (
      <g key={key} stroke={themeColors.accent} strokeWidth={STROKE_PX / zoom}>
        <line x1={p.x - c} y1={p.y} x2={p.x + c} y2={p.y} />
        <line x1={p.x} y1={p.y - c} x2={p.x} y2={p.y + c} />
      </g>
    );
  };
  if (!center) return <g pointerEvents="none">{cross(world!, 'center')}</g>;
  const radius = world
    ? canonicalLineCircleRadius(Math.hypot(world.x - center.x, world.y - center.y))
    : null;
  return (
    <g pointerEvents="none" data-line-circle-preview="">
      {cross(center, 'center')}
      {radius !== null && (
        <>
          <circle
            cx={center.x}
            cy={center.y}
            r={radius}
            fill="none"
            stroke={themeColors.accent}
            strokeWidth={STROKE_PX / zoom}
            strokeDasharray={`${DASH_PX / zoom} ${DASH_PX / zoom}`}
          />
          <CircleDiameterLabel cx={center.x} cy={center.y} radius={radius} zoom={zoom} />
        </>
      )}
    </g>
  );
}
