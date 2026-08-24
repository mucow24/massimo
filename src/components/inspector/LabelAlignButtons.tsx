import type { ReactNode } from 'react';
import { SegmentedToggle } from '../SegmentedToggle';
import {
  AUTO_H_ALIGNS,
  AUTO_V_ALIGNS,
  LABEL_ALIGNS,
  LABEL_VALIGNS,
  isAutoHAlign,
  isAutoVAlign,
  isLabelAlign,
  isLabelValign,
} from '../../model/transforms';
import type { AutoHAlign, AutoVAlign, LabelAlign, LabelValign } from '../../model/types';

const ICON_SIZE = 15;
const LINE_THICKNESS = 1.5;
const LINE_GAP = 2;
const LINE_LENGTHS = [11, 8, 11, 6];

// Sentinel ToggleGroup value for the "auto" segment of the wand-on tuning
// controls, whose domain value is `null` (octant-derived). Radix ToggleGroup
// values are strings, so null needs a stand-in; it's mapped back to null on
// select and via `?? AUTO` on the way in.
const AUTO = '__auto__';

interface Segment {
  // The ToggleGroup value (a string). For the wand-on controls the auto segment
  // uses the AUTO sentinel; every other segment carries its real domain value.
  value: string;
  icon: ReactNode;
  // Accessible name (tests query these) and hover tooltip.
  label: string;
  title: string;
}

/**
 * The shared left/center/right button cluster used across the item popovers,
 * via {@link SegmentedToggle}. Lock is handled by the enclosing fieldset, so no
 * explicit disabled is needed. `flex` is set to the segment count so segments
 * stay equal width even when two groups of different lengths share one row.
 */
function AlignSegmentedGroup({
  ariaLabel,
  value,
  segments,
  onSelect,
}: {
  ariaLabel: string;
  value: string;
  segments: Segment[];
  onSelect: (value: string) => void;
}) {
  return (
    <SegmentedToggle
      ariaLabel={ariaLabel}
      value={value}
      onSelect={onSelect}
      style={{ flex: segments.length }}
      options={segments.map((s) => ({
        value: s.value,
        label: s.label,
        title: s.title,
        content: s.icon,
      }))}
    />
  );
}

// Chip text per member, and the ladders that order the two clusters. Written
// as `Record`s over the unions rather than as segment arrays so a rung added to
// `LabelAlign`/`LabelValign` leaves a missing key here and fails to compile —
// the same backstop `TEXT_LABEL_ALIGN_CHIPS` gives the free text label's align.
// Without it a picker can silently fall behind its own type, and a value the
// cluster never offers is a stored value the user cannot edit.
const H_ALIGN_CHIPS: Record<LabelAlign, { label: string; title: string }> = {
  auto: { label: 'Align auto', title: 'Auto — snap against the adjacent stop' },
  start: { label: 'Align left', title: 'Left' },
  middle: { label: 'Align center', title: 'Center' },
  end: { label: 'Align right', title: 'Right' },
};

const V_ALIGN_CHIPS: Record<LabelValign, { label: string; title: string }> = {
  'auto-down': {
    label: 'V-align auto (down)',
    title: 'Auto-down — first line on the cell, extra lines below',
  },
  top: { label: 'V-align top', title: 'Top' },
  middle: { label: 'V-align middle', title: 'Middle' },
  bottom: { label: 'V-align bottom', title: 'Bottom' },
  'auto-up': {
    label: 'V-align auto (up)',
    title: 'Auto-up — last line on the cell, extra lines above',
  },
};

// The wand-on clusters, same discipline: a `Record` over the union so a rung
// added to `AutoHAlign`/`AutoVAlign` fails to compile here, plus the AUTO
// sentinel's own chip — which is NOT a union member (absent IS auto), so it is
// spelled beside the table rather than inside it.
const AUTO_H_CHIPS: Record<AutoHAlign, { label: string; title: string }> = {
  start: { label: 'Auto align: left', title: 'Left' },
  middle: { label: 'Auto align: center', title: 'Center' },
  end: { label: 'Auto align: right', title: 'Right' },
};
const AUTO_H_AUTO_CHIP = { label: 'Auto align: auto', title: 'Auto (from position)' };

const AUTO_V_CHIPS: Record<AutoVAlign, { label: string; title: string }> = {
  up: { label: 'Auto align V: up', title: 'Up — bottom line anchors, lines stack up' },
  down: { label: 'Auto align V: down', title: 'Down — top line anchors, lines stack down' },
};
const AUTO_V_AUTO_CHIP = {
  label: 'Auto align V: auto',
  title: 'Auto (line nearest the station)',
};

// The icon each auto-V rung borrows from the manual valign glyphs: 'up' stacks
// like auto-up, 'down' like auto-down, and the sentinel takes the neutral
// middle (there is no auto-V glyph of its own).
const AUTO_V_ICON: Record<AutoVAlign, LabelValign> = { up: 'auto-up', down: 'auto-down' };

/**
 * Manual horizontal alignment (wand OFF): auto / left / center / right. `auto`
 * is the legacy half-plane snap — kept so old maps (every station defaults to
 * it) stay editable, not just readable.
 */
export function LabelAlignButtons({
  align,
  onSet,
}: {
  align: LabelAlign;
  onSet: (v: LabelAlign) => void;
}) {
  return (
    <AlignSegmentedGroup
      ariaLabel="Horizontal alignment"
      value={align}
      onSelect={(v) => isLabelAlign(v) && onSet(v)}
      segments={LABEL_ALIGNS.map((mode) => ({
        value: mode,
        icon: <HAlignIcon mode={mode} />,
        ...H_ALIGN_CHIPS[mode],
      }))}
    />
  );
}

/**
 * Manual vertical alignment (wand OFF): auto-down / top / middle / bottom /
 * auto-up. The two auto members grow multi-line blocks down/up from the pinned
 * cell; kept for the same old-map reason as {@link LabelAlignButtons}.
 */
export function LabelValignButtons({
  valign,
  onSet,
}: {
  valign: LabelValign;
  onSet: (v: LabelValign) => void;
}) {
  return (
    <AlignSegmentedGroup
      ariaLabel="Vertical alignment"
      value={valign}
      onSelect={(v) => isLabelValign(v) && onSet(v)}
      segments={LABEL_VALIGNS.map((mode) => ({
        value: mode,
        icon: <VAlignIcon mode={mode} />,
        ...V_ALIGN_CHIPS[mode],
      }))}
    />
  );
}

/**
 * Multi-line tuning for autoAlign labels (wand ON): how the lines align WITHIN
 * the block. `auto` (null) leaves the octant-derived alignment; the anchor line
 * keeps its pinned position, so single-line labels render identically.
 */
export function AutoHAlignButtons({
  value,
  onSet,
}: {
  value: AutoHAlign | null;
  onSet: (v: AutoHAlign | null) => void;
}) {
  return (
    <AlignSegmentedGroup
      ariaLabel="Auto horizontal alignment"
      value={value ?? AUTO}
      onSelect={(v) => (v === AUTO ? onSet(null) : isAutoHAlign(v) && onSet(v))}
      segments={[
        { value: AUTO, icon: <HAlignIcon mode="auto" />, ...AUTO_H_AUTO_CHIP },
        ...AUTO_H_ALIGNS.map((mode) => ({
          value: mode,
          icon: <HAlignIcon mode={mode} />,
          ...AUTO_H_CHIPS[mode],
        })),
      ]}
    />
  );
}

/**
 * Multi-line tuning for autoAlign labels (wand ON): WHICH line anchors. `auto`
 * (null) picks the line nearest the station; 'up' anchors the bottom line
 * (lines stack up), 'down' anchors the top line (lines stack down).
 */
export function AutoVAlignButtons({
  value,
  onSet,
}: {
  value: AutoVAlign | null;
  onSet: (v: AutoVAlign | null) => void;
}) {
  return (
    <AlignSegmentedGroup
      ariaLabel="Auto vertical alignment"
      value={value ?? AUTO}
      onSelect={(v) => (v === AUTO ? onSet(null) : isAutoVAlign(v) && onSet(v))}
      segments={[
        { value: AUTO, icon: <VAlignIcon mode="middle" />, ...AUTO_V_AUTO_CHIP },
        ...AUTO_V_ALIGNS.map((mode) => ({
          value: mode,
          icon: <VAlignIcon mode={AUTO_V_ICON[mode]} />,
          ...AUTO_V_CHIPS[mode],
        })),
      ]}
    />
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
