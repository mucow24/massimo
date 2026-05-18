import {
  SliderIcon,
  SpaceEvenlyHorizontallyIcon,
  RulerHorizontalIcon,
  AllSidesIcon,
} from '@radix-ui/react-icons';
import { useSnapPrefs } from '../state/snapPrefs';
import { useSelection } from '../state/store';
import type { SnapModes } from '../geometry/snap';

interface ToggleSpec {
  key: keyof SnapModes;
  label: string;
  hint: string;
  Icon: React.ComponentType;
  /** When true, this toggle is disabled unless `modes.line` is also on. */
  requiresLine?: boolean;
}

const TOGGLES: ToggleSpec[] = [
  {
    key: 'line',
    label: 'Snap to line',
    hint: 'Lock to the direction of the existing line',
    Icon: SliderIcon,
  },
  {
    key: 'equidistant',
    label: 'Snap to equidistant',
    hint: 'Snap to the midpoint between same-line neighbors',
    Icon: SpaceEvenlyHorizontallyIcon,
    requiresLine: true,
  },
  {
    key: 'tens',
    label: "Snap to 10's",
    hint: 'Snap to multiples of 10 from the previous neighbor',
    Icon: RulerHorizontalIcon,
    requiresLine: true,
  },
  {
    key: 'all',
    label: 'Snap to all',
    hint: 'Snap to vertical, horizontal, or diagonal alignment with any stop',
    Icon: AllSidesIcon,
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
      {TOGGLES.map(({ key, label, hint, Icon, requiresLine }) => {
        const disabled = labelSelected || (!!requiresLine && !modes.line);
        const active = modes[key];
        const title = labelSelected
          ? `${label} — not applicable to labels`
          : disabled
            ? `${label} — enable Snap to line first`
            : `${label} — ${hint}`;
        return (
          <button
            key={key}
            type="button"
            className={'tool-btn' + (active && !disabled ? ' active' : '')}
            aria-pressed={active}
            aria-disabled={disabled}
            aria-label={label}
            title={title}
            onClick={() => {
              if (disabled) return;
              setMode(key, !active);
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
