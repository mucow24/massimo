import type { LineId, LineStyle, StationId } from '../../model/types';
import { useSelection } from '../../state/store';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from '../HatchPatterns';

interface Props {
  style: LineStyle;
  color: string;
  lineId: LineId;
  fromStationId: StationId;
  toStationId: StationId;
  onClick: () => void;
}

const HEIGHT = 8;
const TITLE: Record<LineStyle, string> = {
  solid: 'Segment style: solid (click to set dashed)',
  dashed: 'Segment style: dashed (click to set hatched)',
  hatched: 'Segment style: hatched (click to set hatched-mirror)',
  'hatched-mirror': 'Segment style: hatched-mirror (click to set solid)',
};

// Compact preview row that mirrors the rendered look of a segment between two
// station-list rows. Doubles as a clickable cycler — solid → dashed → hatched.
//
// Carries data-segment-style-divider + data-style for tests; uses role="button"
// with an aria-label so screen-reader-friendly queries can find it.
export function SegmentStyleDivider({
  style,
  color,
  lineId,
  fromStationId,
  toStationId,
  onClick,
}: Props) {
  const { stroke, strokeDasharray } = lineStyleStrokeAttrs(style, color);
  const underlay = lineStyleUnderlayAttrs(style);
  const setHoveredInspectorSegment = useSelection((s) => s.setHoveredInspectorSegment);
  const enter = () => setHoveredInspectorSegment({ lineId, fromStationId, toStationId });
  const leave = () => setHoveredInspectorSegment(null);

  return (
    <button
      type="button"
      data-segment-style-divider
      data-style={style}
      onClick={onClick}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      aria-label={TITLE[style]}
      title={TITLE[style]}
      style={{
        display: 'block',
        width: '100%',
        height: HEIGHT + 4,
        margin: '2px 0',
        padding: 0,
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 3,
        cursor: 'pointer',
      }}
    >
      <svg
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        viewBox={`0 0 100 ${HEIGHT}`}
        style={{ display: 'block' }}
      >
        {(style === 'hatched' || style === 'hatched-mirror') && (
          <defs>
            <HatchPatterns colors={[color]} />
          </defs>
        )}
        {underlay && (
          <line
            x1={0}
            y1={HEIGHT / 2}
            x2={100}
            y2={HEIGHT / 2}
            stroke={underlay.stroke}
            strokeWidth={HEIGHT}
            strokeLinecap={underlay.strokeLinecap}
          />
        )}
        <line
          x1={0}
          y1={HEIGHT / 2}
          x2={100}
          y2={HEIGHT / 2}
          stroke={stroke}
          strokeWidth={HEIGHT}
          strokeDasharray={strokeDasharray}
        />
      </svg>
    </button>
  );
}
