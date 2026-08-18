import { useState, type ReactNode } from 'react';
import { ChevronDownIcon, LoopIcon, PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { DayNightColorRow } from './DayNightColorRow';
import { MenuItem, MenuSeparator } from './Menu';
import { beginHistoryGroup, useDoc } from '../state/store';
import {
  freshPaletteName,
  isLinePalette,
  matchingSwatch,
  withNamedSwatch,
  type Palette,
  type PaletteSwatch,
} from '../model/palettes';
import { swatchPair, swatchRefsEqual } from '../model/swatchRef';
import { dayNightColorsEqual } from '../model/dayNightColor';
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
 * The Custom state's answer to Sync, standing in the same slot: a hand-picked
 * color has no swatch to push into, so the button offers to MAKE it one. The
 * menu lists the map's design palettes and a mint — the mint being the only
 * item a map carrying none can show, and the reason this button stands on the
 * PLAIN row too, where there is no dropdown at all. Saving from there grows the
 * row its dropdown on the next render, naming the swatch it just created.
 *
 * Either branch is ONE gesture: the palette write and the field's link land
 * inside a single history group, so undo can't strand a swatch nothing points
 * at. The swatch goes in before the ref — make the thing, then point at it.
 * That ordering is defensive rather than load-bearing today (both of
 * `addPaletteToMap`'s branches leave a ref written first standing: the upsert
 * sweeps faithful wearers without reconciling, and the add reconciles against a
 * doc the palette is already in), so don't read a bug into a swap; read intent.
 * The pair written is the swatch's own, so the field arrives faithful: no
 * revert badge on a color that has only just been saved.
 */
function SaveToPalette({
  stem,
  titleNoun,
  designPalettes,
  pair,
  disabled,
  onPick,
}: {
  /** What the saved swatch is called. The row's ARIA label, not its visible
   *  one: four sites label the row just "Color", while the accessible names
   *  are distinct by contract (see DayNightColorRow) — "Label color",
   *  "Transfer color" — and a swatch name is read far from the field it came
   *  from. */
  stem: string;
  titleNoun: string;
  designPalettes: Palette[];
  pair: DayNightColor;
  disabled?: boolean;
  onPick: (ref: SwatchRef, pair: DayNightColor) => void;
}) {
  const palettes = useDoc((s) => s.palettes);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  // Where the panel mounts, and what bounds it — `FieldSelectContent`'s pair,
  // resolved the same lazy way and for the same reasons. `.canvas-host` is an
  // isolate layer that would trap a menu opened from an item popover BENEATH
  // the sidebar, so the panel portals into `.app`, which also owns the design
  // tokens and the dark-mode reassignment. It must be resolved by FIRST RENDER:
  // Radix fires `onOpenChange` from a passive effect, after Content has already
  // mounted, so resolving on open would portal the first frame into <body> —
  // unthemed — and then remount the whole subtree under the real container.
  const [{ app, host }] = useState(() => ({
    app: document.querySelector<HTMLElement>('.app'),
    host: document.querySelector<HTMLElement>('.canvas-host'),
  }));

  /** Into `palette`, or — undefined — into a design palette minted for it. */
  const save = (palette?: Palette) => {
    if (palette) {
      // Already in this palette under some name: link to that rather than
      // laying a second swatch over the same color.
      const match = matchingSwatch(palette.swatches, pair);
      if (match) {
        onPick({ palette: palette.name, swatch: match.name }, swatchPair(match));
        return;
      }
      const group = beginHistoryGroup();
      const { swatches, name } = withNamedSwatch(palette.swatches, stem, pair);
      addPaletteToMap({ ...palette, swatches });
      onPick({ palette: palette.name, swatch: name }, pair);
      group.commit();
      return;
    }
    const group = beginHistoryGroup();
    // The stem the Styles tab's own mint counts from.
    const paletteName = freshPaletteName(
      new Set(palettes.map((p) => p.name)),
      'New design palette',
    );
    const { swatches, name } = withNamedSwatch([], stem, pair);
    addPaletteToMap({ name: paletteName, swatches, kind: 'design' });
    onPick({ palette: paletteName, swatch: name }, pair);
    group.commit();
  };

  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="style-row-btn palette-save-btn"
          aria-label={`Save ${titleNoun} to a design palette`}
          title="Save this color to a design palette"
          disabled={disabled}
        >
          <PlusIcon />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal container={app ?? undefined}>
        <Dropdown.Content
          className="menu-panel palette-save-menu"
          align="end"
          sideOffset={4}
          collisionBoundary={host ?? undefined}
          collisionPadding={8}
          loop
        >
          {designPalettes.map((p) => (
            <MenuItem key={p.name} onClick={() => save(p)}>
              {p.name}
            </MenuItem>
          ))}
          {designPalettes.length > 0 && <MenuSeparator />}
          <MenuItem onClick={() => save()}>New design palette…</MenuItem>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/**
 * A themed-color editor row that can LINK to a design-palette swatch — the
 * palette-aware wrapper every `DayNightColorRow` site upgrades to. The sun/moon
 * pair is ALWAYS there, under a dropdown naming where the color comes from:
 * a swatch, or Custom.
 *
 * Picking a swatch calls `onPick(ref, pair)` — the host writes value + ref in
 * ONE patch, so the pickers land on the swatch's colors. Picking Custom calls
 * `onPick(null, currentPair)` — the current values WITHOUT the ref key, which
 * is the detach gesture. With no design palettes in the map and no link, the
 * dropdown would offer nothing, so the row is exactly the plain one.
 *
 * A linked field may then be recolored in place, and that divergence belongs to
 * the PALETTE, not to the style: the style's answer is still "this swatch", so
 * no override dot lights (see `refVerdict` in styles.ts). It shows here
 * instead, as two controls flanking the colors they act on — RESET, restamping
 * the swatch's colors back over the local ones, and SYNC, pushing the local
 * ones into the swatch so the palette and its other faithful wearers catch up.
 * Their slots are held open whenever the field is linked, so a row does not
 * jump as an edit makes them appear.
 *
 * A CUSTOM field has no swatch for either of those to act on, so the trailing
 * slot carries `SaveToPalette` instead — the offer to give the color a swatch
 * to be linked to. It rides the plain row as well, the one piece of chrome a
 * map with no design palette still has use for.
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
  const syncMapPaletteSwatch = useDoc((s) => s.syncMapPaletteSwatch);

  const plainRow = (
    rowLabel: string,
    extra?: { leading?: ReactNode; trailing?: ReactNode; keepRef?: SwatchRef },
  ) => (
    <DayNightColorRow
      label={rowLabel}
      id={id}
      darkId={darkId}
      lightAriaLabel={lightAriaLabel}
      darkAriaLabel={darkAriaLabel}
      titleNoun={titleNoun}
      value={value}
      darkValue={darkValue}
      // While the field is LINKED, a picker edit keeps the link: it writes the
      // new color AND the same ref in one patch, which is what makes the color
      // diverge from its swatch instead of detaching. Going through the host's
      // plain onChange would write a value with no ref key — the detach
      // gesture — and the field would silently fall back to Custom.
      onChange={
        extra?.keepRef ? (c) => onPick(extra.keepRef!, { day: c, night: darkValue }) : onChange
      }
      onDarkChange={
        extra?.keepRef ? (c) => onPick(extra.keepRef!, { day: value, night: c }) : onDarkChange
      }
      disabled={disabled}
      dot={rowLabel === label ? dot : undefined}
      leading={extra?.leading}
      trailing={extra?.trailing}
    />
  );

  const pair = { day: value, night: darkValue };
  const saveButton = (
    <SaveToPalette
      stem={lightAriaLabel}
      titleNoun={titleNoun}
      designPalettes={designPalettes}
      pair={pair}
      disabled={disabled}
      onPick={onPick}
    />
  );

  // No design palettes and no link: the plain row, carrying only the offer to
  // start a palette off this color.
  if (designPalettes.length === 0 && swatchRef === undefined)
    return plainRow(label, { trailing: saveButton });

  const linkedPalette =
    swatchRef === undefined ? undefined : designPalettes.find((p) => p.name === swatchRef.palette);
  const linkedIndex =
    swatchRef === undefined
      ? -1
      : (linkedPalette?.swatches.findIndex((s: PaletteSwatch) => s.name === swatchRef.swatch) ??
        -1);
  const linked = linkedIndex < 0 ? undefined : linkedPalette?.swatches[linkedIndex];

  // Linked but painting something else: the field has been recolored in place.
  const dirty = linked !== undefined && !dayNightColorsEqual(swatchPair(linked), pair);

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
      {/* The pair sits under the dropdown, blank-labelled — the row above
          already names the field (ColorTypeRow's reveal idiom). While the
          field is linked it is flanked by the two palette controls, whose
          slots stay open (empty when the colors agree) so an edit never
          shifts the row. Custom has neither to offer, and carries the save in
          the same trailing slot. */}
      {plainRow(
        '',
        linked
          ? {
              keepRef: swatchRef,
              // The override dot's twin, in BLUE — the same filled circle and
              // ReloadIcon a style override wears, saying the same thing one level
              // down: "this differs from what it links to, click to put it back".
              // It sits against the SUN rather than in the row's gutter, because
              // the gutter is where the red dots speak for the STYLE and this one
              // speaks only for the colors beside it.
              // The slot is ALWAYS here while the field is linked, holding its
              // width whether or not the badge is in it: clicking Reset makes the
              // badge go away, and the pickers beside it must not move when it
              // does.
              leading: (
                <span className="palette-revert-slot">
                  {dirty && (
                    <button
                      type="button"
                      className="override-dot palette-dot-revert"
                      aria-label={`Reset ${titleNoun} to ${swatchRef?.swatch}`}
                      title={`Reset to ${swatchRef?.swatch}`}
                      disabled={disabled}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (swatchRef) onPick(swatchRef, swatchPair(linked));
                      }}
                    >
                      <ReloadIcon aria-hidden="true" />
                    </button>
                  )}
                </span>
              ),
              // The StyleRow Sync button's twin, aimed at the palette instead of
              // the style: same LoopIcon, same idle-until-diverged reading.
              trailing: (
                <button
                  type="button"
                  className="style-row-btn palette-sync-btn"
                  aria-label={`Sync ${titleNoun} to ${swatchRef?.swatch}`}
                  title={`Update ${swatchRef?.swatch} to this color (changes everything using it)`}
                  disabled={disabled || !dirty}
                  onClick={() =>
                    swatchRef && syncMapPaletteSwatch(swatchRef.palette, linkedIndex, pair)
                  }
                >
                  <LoopIcon />
                </button>
              ),
            }
          : { trailing: saveButton },
      )}
    </>
  );
}
