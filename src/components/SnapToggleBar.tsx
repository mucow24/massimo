import {
  SliderIcon,
  SpaceEvenlyHorizontallyIcon,
  RulerHorizontalIcon,
  MoveIcon,
  WidthIcon,
  HeightIcon,
  SlashIcon,
  GridIcon,
  ViewHorizontalIcon,
  ViewVerticalIcon,
} from '@radix-ui/react-icons';
import { useSnapPrefs } from '../state/snapPrefs';
import { useSelection } from '../state/store';
import type { SnapModes } from '../geometry/snap';

/** One state in a toggle's cycle. Index 0 is always the "off" state. */
interface SnapState {
  value: SnapModes[keyof SnapModes];
  Icon: React.ComponentType;
  /** Short name of this state, shown in the tooltip (e.g. "Horizontal only"). */
  name: string;
}

interface ToggleSpec {
  key: keyof SnapModes;
  label: string;
  hint: string;
  /** Ordered cycle of states; clicking advances to the next, wrapping back to
   *  index 0. Boolean toggles are just two-state cycles. */
  states: SnapState[];
  /** When true, this toggle is disabled unless `modes.line` is also on. */
  requiresLine?: boolean;
  /** When true, this toggle applies to text labels too — so it stays
   *  enabled while a label is selected. Defaults to false. */
  appliesToLabels?: boolean;
}

/** A plain on/off toggle modeled as a two-state cycle with one icon. */
function boolStates(Icon: React.ComponentType): SnapState[] {
  return [
    { value: false, Icon, name: 'Off' },
    { value: true, Icon, name: 'On' },
  ];
}

const TOGGLES: ToggleSpec[] = [
  {
    key: 'line',
    label: 'Snap to line',
    hint: 'Lock to the direction of the existing line',
    states: boolStates(SliderIcon),
  },
  {
    key: 'equidistant',
    label: 'Snap to equidistant',
    hint: 'Snap to the midpoint between same-line neighbors',
    states: boolStates(SpaceEvenlyHorizontallyIcon),
    requiresLine: true,
  },
  {
    key: 'tens',
    label: "Snap to 10's",
    hint: 'Snap to multiples of 10 from the previous neighbor',
    states: boolStates(RulerHorizontalIcon),
    requiresLine: true,
  },
  {
    key: 'all',
    label: 'Snap to all',
    hint: 'Align with any stop; click to cycle the direction',
    states: [
      { value: 'off', Icon: MoveIcon, name: 'Off' },
      { value: 'horizontal', Icon: WidthIcon, name: 'Horizontal only' },
      { value: 'vertical', Icon: HeightIcon, name: 'Vertical only' },
      { value: 'diagonal', Icon: SlashIcon, name: 'Diagonal only' },
      { value: 'all', Icon: MoveIcon, name: 'All directions' },
    ],
  },
  {
    key: 'grid',
    label: 'Snap to grid',
    hint: 'Snap to grid lines; click to cycle the direction',
    states: [
      { value: 'off', Icon: GridIcon, name: 'Off' },
      { value: 'horizontal', Icon: ViewHorizontalIcon, name: 'Horizontal lines' },
      { value: 'vertical', Icon: ViewVerticalIcon, name: 'Vertical lines' },
      { value: 'both', Icon: GridIcon, name: 'Both' },
    ],
    appliesToLabels: true,
  },
];

export function SnapToggleBar() {
  const modes = useSnapPrefs((s) => s.modes);
  const setMode = useSnapPrefs((s) => s.setMode);
  // Text labels are free-floating annotations that don't snap, so the snap
  // toggles are meaningless while any label is selected.
  const labelSelected = useSelection((s) => s.selectedLabelIds.length > 0);
  return (
    <div className="tool-group" role="group" aria-label="Snap modes">
      {TOGGLES.map(({ key, label, hint, states, requiresLine, appliesToLabels }) => {
        const labelGated = labelSelected && !appliesToLabels;
        const disabled = labelGated || (!!requiresLine && !modes.line);
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
        const title = labelGated
          ? `${label} — not applicable to labels`
          : disabled
            ? `${label} — enable Snap to line first`
            : active
              ? `${label}: ${state.name} — ${hint} · click to cycle`
              : `${label} — ${hint} · click to cycle`;
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
              if (disabled) return;
              const next = states[(idx + 1) % states.length];
              setMode(key, next.value);
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
