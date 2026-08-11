import type { ReactNode } from 'react';
import { MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { ColorField } from './ColorField';

/**
 * One editor row for a themed color: a label, then the light (☀) and dark (☾)
 * `ColorField` swatches side by side. Every item popover and style editor that
 * carries a day/night color pair renders exactly this shape, so it lives in one
 * place — the `.row` scaffolding, the `aria-hidden` sun/moon glyphs, and the
 * light-then-dark ordering can't drift between copies.
 *
 * The two `title`s are uniform across all sites (`Light mode <noun>` /
 * `Dark mode <noun>`), so they're derived from a single `titleNoun`. The
 * accessible names are NOT uniform between sites (e.g. "Polygon color" vs
 * "Transfer color"), so each field's `ariaLabel` is passed explicitly.
 */
export function DayNightColorRow({
  label,
  id,
  darkId,
  lightAriaLabel,
  darkAriaLabel,
  titleNoun,
  value,
  darkValue,
  onChange,
  onDarkChange,
  disabled,
  dot,
}: {
  label: string;
  /** id of the light swatch; also the row `<label>`'s `htmlFor`. */
  id: string;
  darkId: string;
  lightAriaLabel: string;
  darkAriaLabel: string;
  /** The tail of both tooltips: "Light mode <noun>" / "Dark mode <noun>". */
  titleNoun: string;
  value: string;
  darkValue: string;
  onChange: (c: string) => void;
  onDarkChange: (c: string) => void;
  disabled?: boolean;
  /** Optional override marker (an `OverrideDot`) rendered first in the row. */
  dot?: ReactNode;
}) {
  return (
    <div className={'row' + (disabled ? ' disabled' : '')}>
      {dot}
      <label htmlFor={id}>{label}</label>
      <SunIcon aria-hidden="true" />
      <ColorField
        id={id}
        ariaLabel={lightAriaLabel}
        title={`Light mode ${titleNoun}`}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      <MoonIcon aria-hidden="true" />
      <ColorField
        id={darkId}
        ariaLabel={darkAriaLabel}
        title={`Dark mode ${titleNoun}`}
        value={darkValue}
        disabled={disabled}
        onChange={onDarkChange}
      />
    </div>
  );
}
