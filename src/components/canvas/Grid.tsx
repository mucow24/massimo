import { useThemeColors } from '../../state/theme';

interface Props {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  zoom: number;
  /** Grid cell size in world units (the active toolbar grid size). Spacing
   *  matches the snap engine's `gridInterval` so the visible grid and snapping
   *  always agree. */
  gridSize: number;
}

export const GRID_MIN_SPACING_PX = 5;

/**
 * Level-of-detail step: the smallest power-of-two multiple of gridSize whose
 * on-screen spacing stays at/above GRID_MIN_SPACING_PX. Every designed grid
 * size (5/10/20 world units) passes through untouched at zoom ≥ 1; zoomed
 * out, the drawn grid coarsens instead of collapsing into moiré — at minimum
 * zoom the default grid used to render as a literal solid fill (1px strokes
 * at 1px spacing) built from ~9k DOM lines per frame. Snapping is untouched:
 * it reads gridSize from the store, not from what's drawn.
 */
export function gridStep(gridSize: number, zoom: number): number {
  // Doubling can never rescue a non-positive step or zoom — without this
  // guard the loop below would hang the tab (0 × 2 stays 0). Unreachable
  // through the UI (grid sizes come from GRID_SIZES, zoom is clamped), but a
  // pure exported function shouldn't be able to spin forever on bad input.
  if (!(gridSize > 0) || !(zoom > 0)) return gridSize;
  let step = gridSize;
  while (step * zoom < GRID_MIN_SPACING_PX) step *= 2;
  return step;
}

/**
 * Subtle background grid; spacing matches the snap engine's grid interval
 * (coarsened in powers of two when zoomed out — see {@link gridStep}).
 *
 * The hairlines are sized by `vector-effect="non-scaling-stroke"` rather than
 * the usual world-unit `k / zoom`. A wheel zoom rewrites the viewBox
 * imperatively and doesn't re-render until it settles, so a world-unit width
 * is stale for the whole gesture — the grid visibly fattens as you zoom in and
 * then SNAPS back at the commit. Letting the browser hold the width against
 * the live CTM leaves nothing for the commit to correct. Only `zoom`'s other
 * job, choosing the LOD step, still needs the committed value (spacing is
 * geometry, and it has to agree with what the snap engine uses).
 */
export function Grid({ vbX, vbY, vbW, vbH, zoom, gridSize }: Props) {
  const stroke = useThemeColors().grid;
  const step = gridStep(gridSize, zoom);
  const x0 = Math.floor(vbX / step) * step;
  const y0 = Math.floor(vbY / step) * step;
  const lines: React.ReactElement[] = [];
  for (let x = x0; x <= vbX + vbW; x += step) {
    lines.push(
      <line
        key={'vx' + x}
        x1={x}
        y1={vbY}
        x2={x}
        y2={vbY + vbH}
        stroke={stroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  for (let y = y0; y <= vbY + vbH; y += step) {
    lines.push(
      <line
        key={'hy' + y}
        x1={vbX}
        y1={y}
        x2={vbX + vbW}
        y2={y}
        stroke={stroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}
