import type { LabelAlign, LabelValign } from '../../model/types';
import { ALIGN_CYCLE, VALIGN_CYCLE } from '../../model/transforms';

// The tooltip "→ next" target is derived from the canonical cycles in
// transforms.ts so it can never drift from the actual click behavior.
function nextInCycle<T>(cycle: readonly T[], cur: T): T {
  const i = cycle.indexOf(cur);
  return cycle[(i + 1) % cycle.length];
}

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

export function LabelAlignButton({
  align,
  onCycle,
  disabled,
}: {
  align: LabelAlign;
  onCycle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn-mini label-align-btn"
      aria-label={`Label horizontal alignment: ${ALIGN_TITLE[align]}`}
      title={`H-align: ${ALIGN_TITLE[align]} → ${ALIGN_TITLE[nextInCycle(ALIGN_CYCLE, align)]}`}
      onClick={onCycle}
      disabled={disabled}
    >
      <HAlignIcon mode={align} />
    </button>
  );
}

export function LabelValignButton({
  valign,
  onCycle,
  disabled,
}: {
  valign: LabelValign;
  onCycle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn-mini label-align-btn"
      aria-label={`Label vertical alignment: ${VALIGN_TITLE[valign]}`}
      title={`V-align: ${VALIGN_TITLE[valign]} → ${VALIGN_TITLE[nextInCycle(VALIGN_CYCLE, valign)]}`}
      onClick={onCycle}
      disabled={disabled}
    >
      <VAlignIcon mode={valign} />
    </button>
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
