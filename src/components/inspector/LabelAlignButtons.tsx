import type { ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
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
 * A joined "select-one" segmented control (Radix ToggleGroup): the shared
 * left/center/right button cluster used across the item popovers. Shows the
 * CURRENT value highlighted; clicking a segment sets it. Re-clicking the active
 * segment is a no-op (the empty-string guard keeps it radio-like — you can't
 * deselect into an empty state). Lock is handled by the enclosing fieldset, so
 * no explicit disabled is needed. `flex` is set to the segment count so segments
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
    <ToggleGroup.Root
      type="single"
      className="align-group"
      style={{ flex: segments.length }}
      aria-label={ariaLabel}
      value={value}
      onValueChange={(v) => {
        if (v) onSelect(v);
      }}
    >
      {segments.map((s) => (
        <ToggleGroup.Item
          key={s.value}
          value={s.value}
          className={'align-btn' + (value === s.value ? ' active' : '')}
          aria-label={s.label}
          title={s.title}
        >
          {s.icon}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

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
      onSelect={(v) => onSet(v as LabelAlign)}
      segments={[
        {
          value: 'auto',
          icon: <HAlignIcon mode="auto" />,
          label: 'Align auto',
          title: 'Auto — snap against the adjacent stop',
        },
        { value: 'start', icon: <HAlignIcon mode="start" />, label: 'Align left', title: 'Left' },
        {
          value: 'middle',
          icon: <HAlignIcon mode="middle" />,
          label: 'Align center',
          title: 'Center',
        },
        { value: 'end', icon: <HAlignIcon mode="end" />, label: 'Align right', title: 'Right' },
      ]}
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
      onSelect={(v) => onSet(v as LabelValign)}
      segments={[
        {
          value: 'auto-down',
          icon: <VAlignIcon mode="auto-down" />,
          label: 'V-align auto (down)',
          title: 'Auto-down — first line on the cell, extra lines below',
        },
        { value: 'top', icon: <VAlignIcon mode="top" />, label: 'V-align top', title: 'Top' },
        {
          value: 'middle',
          icon: <VAlignIcon mode="middle" />,
          label: 'V-align middle',
          title: 'Middle',
        },
        {
          value: 'bottom',
          icon: <VAlignIcon mode="bottom" />,
          label: 'V-align bottom',
          title: 'Bottom',
        },
        {
          value: 'auto-up',
          icon: <VAlignIcon mode="auto-up" />,
          label: 'V-align auto (up)',
          title: 'Auto-up — last line on the cell, extra lines above',
        },
      ]}
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
      onSelect={(v) => onSet(v === AUTO ? null : (v as AutoHAlign))}
      segments={[
        {
          value: AUTO,
          icon: <HAlignIcon mode="auto" />,
          label: 'Auto align: auto',
          title: 'Auto (from position)',
        },
        {
          value: 'start',
          icon: <HAlignIcon mode="start" />,
          label: 'Auto align: left',
          title: 'Left',
        },
        {
          value: 'middle',
          icon: <HAlignIcon mode="middle" />,
          label: 'Auto align: center',
          title: 'Center',
        },
        {
          value: 'end',
          icon: <HAlignIcon mode="end" />,
          label: 'Auto align: right',
          title: 'Right',
        },
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
      onSelect={(v) => onSet(v === AUTO ? null : (v as AutoVAlign))}
      segments={[
        {
          value: AUTO,
          icon: <VAlignIcon mode="middle" />,
          label: 'Auto align V: auto',
          title: 'Auto (line nearest the station)',
        },
        {
          value: 'up',
          icon: <VAlignIcon mode="auto-up" />,
          label: 'Auto align V: up',
          title: 'Up — bottom line anchors, lines stack up',
        },
        {
          value: 'down',
          icon: <VAlignIcon mode="auto-down" />,
          label: 'Auto align V: down',
          title: 'Down — top line anchors, lines stack down',
        },
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
