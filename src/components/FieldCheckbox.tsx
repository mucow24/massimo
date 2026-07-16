import * as Checkbox from '@radix-ui/react-checkbox';
import { CheckIcon } from '@radix-ui/react-icons';

/**
 * The app's checkbox: a Radix Checkbox drawn with the chrome's field recipe
 * (hairline box, accent fill + white check when on — see .field-checkbox),
 * so it matches the rest of the chrome instead of the OS. Renders a real
 * `role="checkbox"` button; works inside a wrapping `<label>` (buttons are
 * labelable) and with `htmlFor` via `id`, like the native input it replaced.
 */
export function FieldCheckbox({
  id,
  ariaLabel,
  title,
  checked,
  disabled,
  onCheckedChange,
}: {
  id?: string;
  ariaLabel: string;
  title?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox.Root
      id={id}
      className="field-checkbox"
      aria-label={ariaLabel}
      title={title}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
    >
      <Checkbox.Indicator className="field-checkbox-indicator">
        <CheckIcon />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
