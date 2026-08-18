import { fireEvent, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

// Helpers for driving the react-colorful <ColorField /> in component tests. The
// swatch is a button (not a native <input type=color>), so a test opens its
// portalled picker and sets the color via the picker's hex field.
//
// The swatch is reached by ROLE plus its exact accessible name, never by label
// text alone: a PaletteColorRow's own <label> carries the same words as the
// swatch beside it ("Fill color"), and points at the palette dropdown, so a
// label query matches two controls on every themed row.

/**
 * Open the ColorField picker identified by `label` (its aria-label) and set its
 * hex value in one shot. A single `fireEvent.change` with the complete hex means
 * exactly one onChange round-trip — avoiding the char-by-char intermediate states
 * (`#12` → `#123` → …) that a normalize-on-emit + live-store binding would fold
 * back into the field mid-type. The doc write happens live, so callers can assert
 * immediately. Leaves the picker open.
 */
export async function setColorField(user: UserEvent, label: string, hex: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label }));
  const input = screen.getByLabelText(`${label} hex value`);
  fireEvent.change(input, { target: { value: hex } });
}

/** Open the ColorField picker named `label` and return its hex input, whose
 *  value reflects the current color (`#rrggbb` / `#rrggbbaa`). */
export async function openColorField(user: UserEvent, label: string): Promise<HTMLInputElement> {
  await user.click(screen.getByRole('button', { name: label }));
  return screen.getByLabelText(`${label} hex value`) as HTMLInputElement;
}
