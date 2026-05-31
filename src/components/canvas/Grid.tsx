import { GRID_INTERVAL } from '../../geometry/snap';
import { useViewportStore } from '../../state/viewportStore';

interface Props {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  zoom: number;
}

/** Subtle background grid; spacing matches the snap engine's GRID_INTERVAL. */
export function Grid({ vbX, vbY, vbW, vbH, zoom }: Props) {
  const darkMode = useViewportStore((s) => s.darkMode);
  // Faint light lines read as a grid on black; the light theme keeps its
  // near-white #eee.
  const stroke = darkMode ? '#222' : '#eee';
  const step = GRID_INTERVAL;
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
        strokeWidth={1 / zoom}
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
        strokeWidth={1 / zoom}
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}
