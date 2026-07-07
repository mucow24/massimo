import type { AutoHAlign, AutoVAlign, LabelAlign, LabelValign } from '../../model/types';
import {
  ALIGN_CYCLE,
  AUTO_HALIGN_CYCLE,
  AUTO_VALIGN_CYCLE,
  VALIGN_CYCLE,
} from '../../model/transforms';

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

/**
 * Single cycle button for the label's horizontal alignment: shows the CURRENT
 * state, a click advances one step through ALIGN_CYCLE. The next value is
 * computed here and dispatched as an absolute set, so a mirror broadcast
 * writes the SAME value to every match — matches can't diverge.
 */
export function LabelAlignCycleButton({
  align,
  onSet,
  disabled,
}: {
  align: LabelAlign;
  onSet: (v: LabelAlign) => void;
  disabled?: boolean;
}) {
  const next = ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(align) + 1) % ALIGN_CYCLE.length];
  return (
    <button
      type="button"
      className="chip-btn"
      aria-label={`Align: ${ALIGN_TITLE[align]}`}
      title={`Align: ${ALIGN_TITLE[align]} — click for ${ALIGN_TITLE[next]}`}
      disabled={disabled}
      onClick={() => onSet(next)}
    >
      <HAlignIcon mode={align} />
    </button>
  );
}

/** Vertical-alignment twin of {@link LabelAlignCycleButton} over VALIGN_CYCLE. */
export function LabelValignCycleButton({
  valign,
  onSet,
  disabled,
}: {
  valign: LabelValign;
  onSet: (v: LabelValign) => void;
  disabled?: boolean;
}) {
  const next = VALIGN_CYCLE[(VALIGN_CYCLE.indexOf(valign) + 1) % VALIGN_CYCLE.length];
  return (
    <button
      type="button"
      className="chip-btn"
      aria-label={`V-align: ${VALIGN_TITLE[valign]}`}
      title={`V-align: ${VALIGN_TITLE[valign]} — click for ${VALIGN_TITLE[next]}`}
      disabled={disabled}
      onClick={() => onSet(next)}
    >
      <VAlignIcon mode={valign} />
    </button>
  );
}

const AUTO_HALIGN_TITLE: Record<'auto' | AutoHAlign, string> = {
  auto: 'auto (from position)',
  start: 'left',
  middle: 'center',
  end: 'right',
};

const AUTO_VALIGN_TITLE: Record<'auto' | AutoVAlign, string> = {
  auto: 'auto (line nearest the station)',
  up: 'up (bottom line anchors, lines stack up)',
  down: 'down (top line anchors, lines stack down)',
};

/**
 * Multi-line tuning for autoAlign labels: how the lines align WITHIN the
 * block (the anchor line keeps its auto-derived pinned position). Cycles
 * auto → left → center → right; only meaningful while Auto placement is on,
 * so callers disable it otherwise. Absolute-set dispatch, mirror-safe.
 */
export function AutoHAlignCycleButton({
  value,
  onSet,
  disabled,
}: {
  value: AutoHAlign | null;
  onSet: (v: AutoHAlign | null) => void;
  disabled?: boolean;
}) {
  const next = AUTO_HALIGN_CYCLE[(AUTO_HALIGN_CYCLE.indexOf(value) + 1) % AUTO_HALIGN_CYCLE.length];
  const title = AUTO_HALIGN_TITLE[value ?? 'auto'];
  return (
    <button
      type="button"
      className="chip-btn"
      aria-label={`Auto align H: ${title}`}
      title={`Auto align H: ${title} — click for ${AUTO_HALIGN_TITLE[next ?? 'auto']}`}
      disabled={disabled}
      onClick={() => onSet(next)}
    >
      <HAlignIcon mode={value ?? 'auto'} />
    </button>
  );
}

/**
 * Multi-line tuning for autoAlign labels: WHICH line anchors — 'down' works
 * from the top line (extra lines stack down), 'up' from the bottom line.
 * Cycles auto → up → down; disabled unless Auto placement is on.
 */
export function AutoVAlignCycleButton({
  value,
  onSet,
  disabled,
}: {
  value: AutoVAlign | null;
  onSet: (v: AutoVAlign | null) => void;
  disabled?: boolean;
}) {
  const next = AUTO_VALIGN_CYCLE[(AUTO_VALIGN_CYCLE.indexOf(value) + 1) % AUTO_VALIGN_CYCLE.length];
  const title = AUTO_VALIGN_TITLE[value ?? 'auto'];
  const iconMode: LabelValign =
    value === 'up' ? 'auto-up' : value === 'down' ? 'auto-down' : 'middle';
  return (
    <button
      type="button"
      className="chip-btn"
      aria-label={`Auto align V: ${title}`}
      title={`Auto align V: ${title} — click for ${AUTO_VALIGN_TITLE[next ?? 'auto']}`}
      disabled={disabled}
      onClick={() => onSet(next)}
    >
      <VAlignIcon mode={iconMode} />
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
