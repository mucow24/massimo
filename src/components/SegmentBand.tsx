import { SegmentBandSpec } from '../geometry/interlining';

interface Props {
  spec: SegmentBandSpec;
}

export function SegmentBand({ spec }: Props) {
  return (
    <g>
      {spec.paths.map((d, i) => (
        <path
          key={spec.lines[i].id}
          d={d}
          fill="none"
          stroke={spec.lines[i].color}
          strokeWidth={14}
          strokeLinecap="square"
          strokeLinejoin="round"
        />
      ))}
      {spec.warning && spec.centerline.length > 0 && (
        <text
          x={spec.centerline[Math.floor(spec.centerline.length / 2)].x}
          y={spec.centerline[Math.floor(spec.centerline.length / 2)].y - 4}
          fontSize={14}
          fill="#a22"
          textAnchor="middle"
        >
          ⚠
        </text>
      )}
    </g>
  );
}
