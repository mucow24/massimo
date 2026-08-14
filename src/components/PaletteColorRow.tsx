import type { ReactNode } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { DayNightColorRow } from './DayNightColorRow';
import { useDoc } from '../state/store';
import { isLinePalette, type Palette, type PaletteSwatch } from '../model/palettes';
import { swatchPair, swatchRefsEqual } from '../model/swatchRef';
import type { DayNightColor, SwatchRef } from '../model/types';

const CUSTOM = '__custom__';
// A Radix Select item value is a string; palette/swatch names are free-form
// user text, so the tuple is JSON-encoded (always unambiguous) rather than
// joined on a separator a name could contain.
const encodeRef = (r: SwatchRef): string => JSON.stringify([r.palette, r.swatch]);
const decodeRef = (v: string): SwatchRef => {
  const [palette, swatch] = JSON.parse(v) as [string, string];
  return { palette, swatch };
};

/** The two theme halves side by side — how a design swatch is recognised. */
function SplitSwatch({ pair }: { pair: DayNightColor }) {
  return (
    <span className="palette-split-swatch" aria-hidden="true">
      <span style={{ background: pair.day }} />
      <span style={{ background: pair.night }} />
    </span>
  );
}

/**
 * A themed-color editor row that can LINK to a design-palette swatch — the
 * palette-aware wrapper every `DayNightColorRow` site upgrades to.
 *
 * Three states:
 *  - The map carries no design palettes (and the field no link): exactly the
 *    plain `DayNightColorRow`, zero new chrome.
 *  - LINKED (`swatchRef` present): one row — label, then a dropdown whose
 *    trigger shows the swatch's split day/night colors and its NAME. No pair
 *    pickers; the swatch is the single source of the colors.
 *  - CUSTOM: the dropdown reads "Custom" and the sun/moon pair reveals
 *    beneath (ColorTypeRow's reveal idiom), seeded with the current colors;
 *    edits land through the plain onChange/onDarkChange (whose transforms
 *    detach any ref by the write rule).
 *
 * Picking a swatch calls `onPick(ref, pair)` — the host writes value + ref in
 * ONE patch. Picking Custom calls `onPick(null, currentPair)` — the host
 * writes the current values WITHOUT the ref key, which is the detach gesture.
 */
export function PaletteColorRow({
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
  onPick,
  swatchRef,
  disabled,
  dot,
}: {
  label: string;
  id: string;
  darkId: string;
  lightAriaLabel: string;
  darkAriaLabel: string;
  titleNoun: string;
  value: string;
  darkValue: string;
  onChange: (c: string) => void;
  onDarkChange: (c: string) => void;
  /** Write value + ref together (a swatch pick), or values-without-ref (null
   *  = the Custom pick, detaching). */
  onPick: (ref: SwatchRef | null, pair: DayNightColor) => void;
  swatchRef: SwatchRef | undefined;
  disabled?: boolean;
  dot?: ReactNode;
}) {
  const designPalettes = useDoc((s) => s.palettes).filter((p: Palette) => !isLinePalette(p));

  const plainRow = (rowLabel: string) => (
    <DayNightColorRow
      label={rowLabel}
      id={id}
      darkId={darkId}
      lightAriaLabel={lightAriaLabel}
      darkAriaLabel={darkAriaLabel}
      titleNoun={titleNoun}
      value={value}
      darkValue={darkValue}
      onChange={onChange}
      onDarkChange={onDarkChange}
      disabled={disabled}
      dot={rowLabel === label ? dot : undefined}
    />
  );

  // No design palettes and no link: today's plain row, zero new chrome.
  if (designPalettes.length === 0 && swatchRef === undefined) return plainRow(label);

  const linked =
    swatchRef === undefined
      ? undefined
      : designPalettes
          .find((p) => p.name === swatchRef.palette)
          ?.swatches.find((s: PaletteSwatch) => s.name === swatchRef.swatch);

  const selectId = `${id}-palette`;
  return (
    <>
      <div className={'row' + (disabled ? ' disabled' : '')}>
        {dot}
        <label htmlFor={selectId}>{label}</label>
        <Select.Root
          value={swatchRef !== undefined && linked ? encodeRef(swatchRef) : CUSTOM}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === CUSTOM) {
              onPick(null, { day: value, night: darkValue });
              return;
            }
            const ref = decodeRef(v);
            const swatch = designPalettes
              .find((p) => p.name === ref.palette)
              ?.swatches.find((s: PaletteSwatch) => s.name === ref.swatch);
            if (swatch) onPick(ref, swatchPair(swatch));
          }}
        >
          <Select.Trigger
            id={selectId}
            className="field-select palette-color-trigger"
            aria-label={`${label} palette color`}
          >
            <Select.Value>
              {linked && swatchRef ? (
                <>
                  <SplitSwatch pair={swatchPair(linked)} />
                  {swatchRef.swatch}
                </>
              ) : (
                'Custom'
              )}
            </Select.Value>
            <Select.Icon className="field-select-caret" aria-hidden="true">
              <ChevronDownIcon />
            </Select.Icon>
          </Select.Trigger>
          <FieldSelectContent>
            {designPalettes.map((p) => (
              <Select.Group key={p.name}>
                <Select.Label className="field-select-group-label">{p.name}</Select.Label>
                {p.swatches.map((s) => {
                  const ref = { palette: p.name, swatch: s.name };
                  return (
                    <Select.Item
                      key={s.name}
                      value={encodeRef(ref)}
                      className={
                        'field-select-item palette-color-item' +
                        (swatchRefsEqual(swatchRef, ref) ? ' selected' : '')
                      }
                    >
                      <SplitSwatch pair={swatchPair(s)} />
                      <Select.ItemText>{s.name}</Select.ItemText>
                    </Select.Item>
                  );
                })}
              </Select.Group>
            ))}
            <Select.Separator className="field-select-separator" aria-hidden="true" />
            <Select.Item value={CUSTOM} className="field-select-item">
              <Select.ItemText>Custom</Select.ItemText>
            </Select.Item>
          </FieldSelectContent>
        </Select.Root>
      </div>
      {/* Custom: the pair reveals beneath, blank-labelled — the dropdown row
          above already names the field (ColorTypeRow's reveal idiom). */}
      {(swatchRef === undefined || !linked) && plainRow('')}
    </>
  );
}
