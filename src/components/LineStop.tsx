import { STOP_SIZE } from '../geometry/orientation';

interface Props {
  cx: number;
  cy: number;
  color: string;
}

export function LineStop({ cx, cy, color }: Props) {
  const half = STOP_SIZE / 2;
  return (
    <g pointerEvents="none">
      <rect x={cx - half} y={cy - half} width={STOP_SIZE} height={STOP_SIZE} fill={color} />
      <circle cx={cx} cy={cy} r={STOP_SIZE * 0.28} fill="#000" />
    </g>
  );
}
