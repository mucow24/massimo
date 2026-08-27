import {
  SliderIcon,
  SpaceEvenlyHorizontallyIcon,
  RulerHorizontalIcon,
  MoveIcon,
  WidthIcon,
  HeightIcon,
  SizeIcon,
  GridIcon,
  CircleIcon,
  ViewHorizontalIcon,
  ViewVerticalIcon,
} from '@radix-ui/react-icons';
import { useSnapPrefs } from '../state/snapPrefs';
import { useViewportStore } from '../state/viewportStore';
import type { SnapModes } from '../geometry/snap';
import { CIRCLE_CARDINAL_ANGLES } from '../geometry/lineCircle';

// Radix's CircleIcon is a 15×15 annulus centred on (7.5, 7.5), inner radius
// 5.673 and outer 6.623 — so a 0.95-wide stroke on radius 6.148 reproduces it
// exactly. Matching it matters: the cardinals glyph must read as that SAME ring
// with marks added, nothing else moving.
const ICON_RING_R = 6.148;
const ICON_RING_STROKE = 0.95;
const ICON_DOT_R = 1.1;

/**
 * The "off" glyph (Radix `CircleIcon`) with a dot on each cardinal. Local rather
 * than vendored because there is no Radix icon for it; the ring geometry above
 * is Radix's own, and the dot ANGLES come from the geometry module, so the
 * button can't claim a cardinal the snap doesn't honour.
 */
function CircleCardinalsIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <circle
        cx={7.5}
        cy={7.5}
        r={ICON_RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON_RING_STROKE}
      />
      {CIRCLE_CARDINAL_ANGLES.map((t, k) => (
        <circle
          key={k}
          cx={7.5 + ICON_RING_R * Math.cos(t)}
          cy={7.5 + ICON_RING_R * Math.sin(t)}
          r={ICON_DOT_R}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** One state in a toggle's cycle. Index 0 is always the "off" state. */
interface SnapState<V> {
  value: V;
  Icon: React.ComponentType;
  /** Short name of this state, shown in the tooltip (e.g. "Horizontal only"). */
  name: string;
}

/**
 * One toggle's spec, CORRELATED to its mode key: the mapped type is distributed
 * over `keyof SnapModes` and then indexed back into a union, so each arm pairs a
 * single key with states carrying only that key's value type. Spelling it as a
 * flat `{ key: keyof SnapModes; states: SnapState<SnapModes[keyof SnapModes]>[] }`
 * would take the value type across ALL keys, and happily accept `key: 'line'`
 * with the directional states — which matters because `useSnapPrefs.setMode`
 * takes that same widened value type and names THIS table as the thing that
 * decides which values are legal per key. The correlation is what makes that
 * true; it costs no call-site casts, because `TOGGLES` is a literal.
 */
type ToggleSpec = {
  [K in keyof SnapModes]: {
    key: K;
    label: string;
    hint: string;
    /** Ordered cycle of states; clicking advances to the next, wrapping back to
     *  index 0. Boolean toggles are just two-state cycles. */
    states: SnapState<SnapModes[K]>[];
    /** When true, this toggle is disabled unless `modes.line` is also on. */
    requiresLine?: boolean;
  };
}[keyof SnapModes];

/** A plain on/off toggle modeled as a two-state cycle with one icon. */
function boolStates(Icon: React.ComponentType): SnapState<boolean>[] {
  return [
    { value: false, Icon, name: 'Off' },
    { value: true, Icon, name: 'On' },
  ];
}

const TOGGLES: ToggleSpec[] = [
  {
    key: 'line',
    label: 'Snap to line',
    hint: 'lock the drag to the line’s direction',
    states: boolStates(SliderIcon),
  },
  {
    key: 'equidistant',
    label: 'Snap to equidistant',
    hint: 'snap to the midpoint between same-line neighbors (stations only)',
    states: boolStates(SpaceEvenlyHorizontallyIcon),
    requiresLine: true,
  },
  {
    key: 'tens',
    label: 'Snap to grid length',
    hint: 'notch to whole grid steps from the nearest neighbour, target, or guide',
    states: boolStates(RulerHorizontalIcon),
  },
  {
    key: 'all',
    label: 'Snap to all',
    hint: 'align with any other stop',
    states: [
      { value: 'off', Icon: MoveIcon, name: 'Off' },
      { value: 'horizontal', Icon: WidthIcon, name: 'Horizontal only' },
      { value: 'vertical', Icon: HeightIcon, name: 'Vertical only' },
      { value: 'diagonal', Icon: SizeIcon, name: 'Diagonal only' },
      { value: 'all', Icon: MoveIcon, name: 'All directions' },
    ],
  },
  {
    key: 'grid',
    label: 'Snap to grid',
    hint: 'snap to grid lines',
    states: [
      { value: 'off', Icon: GridIcon, name: 'Off' },
      { value: 'horizontal', Icon: ViewHorizontalIcon, name: 'Horizontal lines' },
      { value: 'vertical', Icon: ViewVerticalIcon, name: 'Vertical lines' },
      { value: 'both', Icon: GridIcon, name: 'Both' },
    ],
  },
  {
    key: 'circle',
    label: 'Snap to line circle cardinals',
    hint: 'snap to the 8 cardinal points of line circles',
    // Not `boolStates` — this is the one toggle whose two states want DIFFERENT
    // glyphs, because the off glyph is load-bearing: a plain ring says circles
    // capture regardless (only Shift declines), and the dots say the cardinals
    // are live on top of that.
    states: [
      { value: false, Icon: CircleIcon, name: 'Off' },
      { value: true, Icon: CircleCardinalsIcon, name: 'On' },
    ],
  },
];

/**
 * Advance one snap toggle a single step (wrapping), exactly as clicking its
 * button once would. `index` is the toggle's position in {@link TOGGLES} — also
 * the toolbar order and the digit keyboard shortcut (1–{@link SNAP_TOGGLE_COUNT}). Returns the mode key and its
 * next value, or `null` when the index is out of range or the toggle is disabled
 * (equidistant while `line` is off), matching a click on a disabled button (a
 * no-op). Shared by the toolbar's onClick and App's number-key handler so a
 * keypress is precisely one click.
 */
export function advanceSnapToggle(
  modes: SnapModes,
  index: number,
): { key: keyof SnapModes; value: SnapModes[keyof SnapModes] } | null {
  const spec = TOGGLES[index];
  if (!spec) return null;
  if (spec.requiresLine && !modes.line) return null;
  const idx = Math.max(
    0,
    spec.states.findIndex((s) => s.value === modes[spec.key]),
  );
  const next = spec.states[(idx + 1) % spec.states.length];
  return { key: spec.key, value: next.value };
}

/** Count of snap toggles = the number of `1..N` keyboard shortcuts. */
export const SNAP_TOGGLE_COUNT = TOGGLES.length;

/**
 * Every toggle's SHORT name, in the order the `1..N` keys press them. The help
 * sheet's snap row is built from this rather than re-listing the toggles two
 * modules away, so a toggle added or reordered here cannot leave that row
 * quietly describing the old bar.
 *
 * Each `label` reads "Snap to <name>" — the prefix is the tooltip's phrasing,
 * not part of the name. SnapToggleBar.test.tsx holds the rendered labels to
 * that form, so a label written another way fails there rather than leaking a
 * stray "Snap to …" into the help sheet.
 */
export const SNAP_TOGGLE_NAMES: readonly string[] = TOGGLES.map((t) =>
  t.label.replace(/^Snap to /, ''),
);

export function SnapToggleBar() {
  const modes = useSnapPrefs((s) => s.modes);
  const setMode = useSnapPrefs((s) => s.setMode);
  const gridSize = useViewportStore((s) => s.gridSize);
  return (
    <div className="tool-group" role="group" aria-label="Snap modes">
      {TOGGLES.map(({ key, label, hint, states, requiresLine }, i) => {
        const disabled = !!requiresLine && !modes.line;
        const value = modes[key];
        const idx = Math.max(
          0,
          states.findIndex((s) => s.value === value),
        );
        const state = states[idx];
        // "Active" = any state past Off (index 0). Drives the styling +
        // aria-pressed; the exact sub-mode lives in title/data-snap-state.
        const active = idx > 0;
        const { Icon } = state;
        // "Snap to grid length" shows the live grid size in its tooltip (5/10/20)
        // so the user sees what "one step" currently means. aria-label stays the
        // bare label for stable a11y/testing.
        const displayLabel = key === 'tens' ? `${label} (${gridSize}'s)` : label;
        // Only the directional toggles earn a cycling hint — a plain on/off
        // button explaining "click to toggle" would be noise.
        const cycleHint = states.length > 2 ? ' · click to cycle direction' : '';
        const title = disabled
          ? `${displayLabel} — enable Snap to line first`
          : active
            ? `${displayLabel}: ${state.name} — ${hint}${cycleHint}`
            : `${displayLabel} — ${hint}${cycleHint}`;
        return (
          <button
            key={key}
            type="button"
            className={'tool-btn' + (active && !disabled ? ' active' : '')}
            aria-pressed={active}
            aria-disabled={disabled}
            aria-label={label}
            data-snap-state={String(value)}
            title={title}
            onClick={() => {
              const next = advanceSnapToggle(modes, i);
              if (next) setMode(next.key, next.value);
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
