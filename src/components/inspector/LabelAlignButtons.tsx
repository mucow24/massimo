import type { LabelAlign, LabelValign } from '../../model/types';
import { ALIGN_CYCLE, VALIGN_CYCLE } from '../../model/transforms';

const ALIGN_TITLE: Record<LabelAlign, string> = {
  auto: 'auto (snap against adjacent stop)',
  start: 'left',
  middle: 'center',
  end: 'right',
};

const VALIGN_TITLE: Record<LabelValign, string> = {
  'auto-down': 'auto-down (first line on cell, extra lines below)',
  top: 'top',
  middle: 'middle',
  bottom: 'bottom',
  'auto-up': 'auto-up (last line on cell, extra lines above)',
};

const ICON_SIZE = 15;
const LINE_THICKNESS = 1.5;
const LINE_GAP = 2;
const LINE_LENGTHS = [11, 8, 11, 6];

export function LabelAlignPicker({
  align,
  onSet,
  disabled,
}: {
  align: LabelAlign;
  onSet: (v: LabelAlign) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg-group" role="group" aria-label="Label horizontal alignment">
      {ALIGN_CYCLE.map((mode) => (
        <button
          key={mode}
          type="button"
          className={'seg-btn' + (align === mode ? ' active' : '')}
          aria-label={`Align: ${ALIGN_TITLE[mode]}`}
          title={`Align: ${ALIGN_TITLE[mode]}`}
          aria-pressed={align === mode}
          disabled={disabled}
          onClick={() => onSet(mode)}
        >
          <HAlignIcon mode={mode} />
        </button>
      ))}
    </div>
  );
}

export function LabelValignPicker({
  valign,
  onSet,
  disabled,
}: {
  valign: LabelValign;
  onSet: (v: LabelValign) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg-group" role="group" aria-label="Label vertical alignment">
      {VALIGN_CYCLE.map((mode) => (
        <button
          key={mode}
          type="button"
          className={'seg-btn' + (valign === mode ? ' active' : '')}
          aria-label={`V-align: ${VALIGN_TITLE[mode]}`}
          title={`V-align: ${VALIGN_TITLE[mode]}`}
          aria-pressed={valign === mode}
          disabled={disabled}
          onClick={() => onSet(mode)}
        >
          <VAlignIcon mode={mode} />
        </button>
      ))}
    </div>
  );
}

function HAlignIcon({ mode }: { mode: LabelAlign }) {
  const W = ICON_SIZE;
  const H = ICON_SIZE;
  const yOffset = (H - 4 * LINE_THICKNESS - 3 * LINE_GAP) / 2;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {LINE_LENGTHS.map((len, i) => {
        let x: number;
        if (mode === 'start') x = 2;
        else if (mode === 'end') x = W - 2 - len;
        else x = (W - len) / 2;
        const y = yOffset + i * (LINE_THICKNESS + LINE_GAP);
        return <rect key={i} x={x} y={y} width={len} height={LINE_THICKNESS} fill="currentColor" />;
      })}
      {mode === 'auto' && (
        <g>
          <path d={`M0 ${H / 2} L2 ${H / 2 - 2} L2 ${H / 2 + 2} Z`} fill="currentColor" />
          <path
            d={`M${W} ${H / 2} L${W - 2} ${H / 2 - 2} L${W - 2} ${H / 2 + 2} Z`}
            fill="currentColor"
          />
        </g>
      )}
    </svg>
  );
}

function VAlignIcon({ mode }: { mode: LabelValign }) {
  const W = ICON_SIZE;
  const H = ICON_SIZE;
  const totalLineH = 4 * LINE_THICKNESS + 3 * LINE_GAP;
  // 'auto-down' lines from the icon's vertical middle and stack downward, so
  // the first line sits on the cell-center mark and additional lines hang
  // below. 'auto-up' is the mirror: the LAST line sits on the cell-center
  // mark and earlier lines stack above. A faint tick at the left marks the
  // anchor row in both auto modes.
  const lineStep = LINE_THICKNESS + LINE_GAP;
  let yStart: number;
  if (mode === 'top') yStart = 2;
  else if (mode === 'bottom') yStart = H - 2 - totalLineH;
  else if (mode === 'auto-down') yStart = (H - LINE_THICKNESS) / 2;
  else if (mode === 'auto-up')
    yStart = (H - LINE_THICKNESS) / 2 - (LINE_LENGTHS.length - 1) * lineStep;
  else yStart = (H - totalLineH) / 2;
  const isAuto = mode === 'auto-down' || mode === 'auto-up';
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {LINE_LENGTHS.map((len, i) => {
        const x = (W - len) / 2;
        const y = yStart + i * lineStep;
        return <rect key={i} x={x} y={y} width={len} height={LINE_THICKNESS} fill="currentColor" />;
      })}
      {isAuto && (
        <rect
          x={0}
          y={(H - LINE_THICKNESS) / 2}
          width={1.5}
          height={LINE_THICKNESS}
          fill="currentColor"
        />
      )}
    </svg>
  );
}
