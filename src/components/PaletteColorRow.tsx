import { useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, LoopIcon, ReloadIcon } from '@radix-ui/react-icons';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { DayNightColorRow } from './DayNightColorRow';
import { MenuItem, MenuSeparator, SubMenu } from './Menu';
import { useInlineRename } from './useInlineRename';
import { beginHistoryGroup, useDoc } from '../state/store';
import {
  freshPaletteName,
  isLinePalette,
  matchingSwatch,
  withNamedSwatch,
  type Palette,
  type PaletteSwatch,
} from '../model/palettes';
import { swatchPair } from '../model/swatchRef';
import { dayNightColorsEqual } from '../model/dayNightColor';
import type { DayNightColor, SwatchRef } from '../model/types';

const CUSTOM = '__custom__';
// A Radix radio item's value is a string; palette/swatch names are free-form
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
 * palette-aware wrapper every `DayNightColorRow` site upgrades to. The sun/moon
 * pair is ALWAYS there, under a dropdown naming where the color comes from:
 * a swatch, or Custom.
 *
 * The dropdown is a MENU rather than a Select, and the reason is its last row.
 * **Save color to palette** needs a flyout of the map's design palettes, and a
 * Radix Select has no submenu to give it; a menu does (the same `SubMenu` the
 * toolbar's Export uses). What it costs is the `combobox` role — the swatch
 * rows are `menuitemradio` under one `RadioGroup`, which keeps the "which one
 * is current" reading a Select gave for free, and Radix menus carry typeahead
 * of their own.
 *
 * Picking a swatch calls `onPick(ref, pair)` — the host writes value + ref in
 * ONE patch, so the pickers land on the swatch's colors. Picking Custom calls
 * `onPick(null, currentPair)` — the current values WITHOUT the ref key, which
 * is the detach gesture.
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
 * The dropdown stands on EVERY map, including one carrying no design palette
 * at all: the save's flyout always offers to mint one, so the row is never a
 * dead end. That is what pays for a dropdown whose only other row is Custom.
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
  const palettes = useDoc((s) => s.palettes);
  const designPalettes = palettes.filter((p: Palette) => !isLinePalette(p));
  const syncMapPaletteSwatch = useDoc((s) => s.syncMapPaletteSwatch);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  const pair = { day: value, night: darkValue };

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

  // The design palette the save will land in, once it is known. The mint does
  // not know it until its first field commits, and nothing reaches the doc
  // until the second one does, so backing out at either stage leaves the map
  // untouched.
  const [target, setTarget] = useState<string | null>(null);
  // Set by every keystroke, read once at commit: `useInlineRename` cannot tell
  // Enter from a blur, and the palette stage needs to (see below). Cleared
  // wherever a name field OPENS, because the flag belongs to the attempt and
  // not to the row — one left standing by an earlier commit would make the
  // next chain advance on a blur that ought to have abandoned it.
  const viaEnter = useRef(false);

  /**
   * What the color's name field opens on. A palette already painting this
   * color seeds THAT swatch's name, so committing as-is links to it instead of
   * laying a second swatch over one color — typing over the seed is how the
   * copy is asked for. Otherwise it is the field's own name, already counted
   * up past any collision: names are the ref key, and a seed that promised
   * "Fill color" while the dedupe silently landed "Fill color 2" would show
   * the user a name their swatch does not have.
   */
  const swatchSeed = (into: string): string => {
    const palette = designPalettes.find((p) => p.name === into);
    if (!palette) return lightAriaLabel;
    const match = matchingSwatch(palette.swatches, pair);
    if (match) return match.name;
    return freshPaletteName(new Set(palette.swatches.map((s) => s.name)), lightAriaLabel);
  };

  /**
   * The write both branches of the save end in, once every name is known.
   *
   * The typed name is what chooses between the two outcomes, exactly as a
   * style name does one level up: a name the palette already holds REDEFINES
   * that swatch (`syncMapPaletteSwatch`, the write the Sync button makes, so
   * its other faithful wearers come along), and any other name appends. Two
   * swatches cannot share a name — it is the ref key — so the alternative to
   * redefining would be a silent count-up onto a name nobody asked for.
   *
   * Both halves go in under one history group, so undo cannot strand a swatch
   * nothing points at, and the palette write lands BEFORE the link. That
   * ordering is defensive rather than load-bearing today (both of
   * `addPaletteToMap`'s branches leave a ref written first standing), so don't
   * read a bug into a swap; read intent. The pair written is the swatch's own,
   * so the field arrives faithful: no revert badge on a color just saved.
   */
  const save = (into: string, swatchName: string) => {
    const palette = designPalettes.find((p) => p.name === into);
    const group = beginHistoryGroup();
    if (palette) {
      const existing = palette.swatches.findIndex((s: PaletteSwatch) => s.name === swatchName);
      if (existing >= 0) {
        syncMapPaletteSwatch(palette.name, existing, pair);
        onPick({ palette: palette.name, swatch: swatchName }, pair);
      } else {
        const { swatches, name } = withNamedSwatch(palette.swatches, swatchName, pair);
        addPaletteToMap({ ...palette, swatches });
        onPick({ palette: palette.name, swatch: name }, pair);
      }
    } else {
      // A minted palette, under a name the map does not already hold:
      // `addPaletteToMap` REPLACES a same-named palette (that is the refresh
      // the library re-add needs), which reached through a typed name would
      // wipe every other swatch in it and drop their refs. `freshPaletteName`
      // is a no-op on a free name and counts up past a taken one — including a
      // LINE palette's, which the design branch above would never have found.
      const fresh = freshPaletteName(new Set(palettes.map((p: Palette) => p.name)), into);
      const { swatches, name } = withNamedSwatch([], swatchName, pair);
      addPaletteToMap({ name: fresh, swatches, kind: 'design' });
      onPick({ palette: fresh, swatch: name }, pair);
    }
    group.commit();
  };

  // Shared inline-rename plumbing (same as StyleRow / the Styles panel), one
  // instance per name the save can ask for. Two rather than one switched by a
  // flag, because the mint HANDS OFF from the first to the second: a lone
  // instance would have to call its own `start` from inside its own commit.
  // The color's is declared first so the palette's can reach it.
  //
  // Neither calls back on Escape, so `editing` is what decides whether a field
  // is on screen — never the target, which outlives an abandoned attempt.
  const colorName = useInlineRename((draft) => {
    const typed = draft.trim();
    // Empty cancels, the rule every inline rename in the app shares.
    if (typed && target) save(target, typed);
  });
  const paletteName = useInlineRename((draft) => {
    const typed = draft.trim();
    // Advancing a chain, not committing one. Only Enter carries on: a blur
    // means the user clicked something else, and mounting the next field then
    // would snatch focus straight back out of whatever they hit.
    if (!typed || !viaEnter.current) return;
    viaEnter.current = false;
    setTarget(typed);
    colorName.start(swatchSeed(typed));
  });

  /** Into `palette`, or — undefined — into a design palette named on the spot. */
  const startSave = (palette?: Palette) => {
    viaEnter.current = false;
    if (palette) {
      setTarget(palette.name);
      colorName.start(swatchSeed(palette.name));
      return;
    }
    setTarget(null);
    // The stem the Styles tab's own mint counts from.
    paletteName.start(
      freshPaletteName(new Set(palettes.map((p: Palette) => p.name)), 'New design palette'),
    );
  };

  const plainRow = (extra?: { leading?: ReactNode; trailing?: ReactNode; keepRef?: SwatchRef }) => (
    <DayNightColorRow
      label=""
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
      leading={extra?.leading}
      trailing={extra?.trailing}
    />
  );

  // Mid-save: the dropdown's slot carries the name field instead, and the pair
  // stays put beneath it — you are naming a color, so the color has to be in
  // front of you while you do. The key remounts the field between the mint's
  // two stages, without which `autoFocus` (having already fired) would leave
  // the second one waiting unfocused.
  if (paletteName.editing || colorName.editing) {
    const forPalette = paletteName.editing;
    const nameLabel = forPalette ? 'Palette name' : 'Color name';
    const inputProps = forPalette ? paletteName.inputProps : colorName.inputProps;
    return (
      <>
        <div className={'row' + (disabled ? ' disabled' : '')}>
          {dot}
          <label htmlFor={`${id}-save-name`}>{label}</label>
          <input
            key={nameLabel}
            id={`${id}-save-name`}
            className="palette-name-input"
            aria-label={nameLabel}
            placeholder={nameLabel}
            {...inputProps}
            onKeyDown={(e) => {
              viaEnter.current = e.key === 'Enter';
              inputProps.onKeyDown(e);
            }}
          />
        </div>
        {plainRow()}
      </>
    );
  }

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
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              id={selectId}
              className="field-select palette-color-trigger"
              aria-label={`${label} palette color`}
              disabled={disabled}
            >
              <span>
                {linked && swatchRef ? (
                  <>
                    <SplitSwatch pair={swatchPair(linked)} />
                    {swatchRef.swatch}
                  </>
                ) : (
                  'Custom'
                )}
              </span>
              <span className="field-select-caret" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal container={app ?? undefined}>
            <Dropdown.Content
              className="menu-panel palette-color-menu"
              align="start"
              sideOffset={4}
              collisionBoundary={host ?? undefined}
              collisionPadding={8}
              loop
            >
              <Dropdown.RadioGroup
                // Radix renders the group as a real div between the capped
                // panel and the scroll box — the class keeps it a shrinkable
                // flex column so the cap reaches the scroll box at all (see
                // .palette-color-options in styles.css).
                className="palette-color-options"
                value={swatchRef !== undefined && linked ? encodeRef(swatchRef) : CUSTOM}
                onValueChange={(v) => {
                  if (v === CUSTOM) {
                    onPick(null, pair);
                    return;
                  }
                  const ref = decodeRef(v);
                  const swatch = designPalettes
                    .find((p) => p.name === ref.palette)
                    ?.swatches.find((s: PaletteSwatch) => s.name === ref.swatch);
                  if (swatch) onPick(ref, swatchPair(swatch));
                }}
              >
                {/* Only the swatch list scrolls. A Radix submenu renders in
                    PLACE rather than in a portal of its own, so a flyout with
                    an `overflow` ancestor is a flyout that gets clipped — the
                    Save row has to stay outside this box, and Custom rides
                    along so the two commands sit together at the foot. */}
                <div className="palette-color-scroll">
                  {designPalettes.map((p) => (
                    <Dropdown.Group key={p.name}>
                      <Dropdown.Label className="menu-group-label">{p.name}</Dropdown.Label>
                      {p.swatches.map((s: PaletteSwatch) => (
                        <Dropdown.RadioItem
                          key={s.name}
                          value={encodeRef({ palette: p.name, swatch: s.name })}
                          className="menu-item palette-color-item"
                        >
                          <SplitSwatch pair={swatchPair(s)} />
                          {s.name}
                        </Dropdown.RadioItem>
                      ))}
                    </Dropdown.Group>
                  ))}
                </div>
                {designPalettes.length > 0 && <MenuSeparator />}
                <Dropdown.RadioItem value={CUSTOM} className="menu-item">
                  Custom
                </Dropdown.RadioItem>
              </Dropdown.RadioGroup>
              <MenuSeparator />
              {/* Offered in BOTH states, which is what makes "save a copy"
                  reachable: a linked color saved under a fresh name becomes a
                  second swatch rather than overwriting the one it wears. */}
              <SubMenu label="Save color to palette">
                {designPalettes.map((p) => (
                  <MenuItem key={p.name} onClick={() => startSave(p)}>
                    {p.name}
                  </MenuItem>
                ))}
                {designPalettes.length > 0 && <MenuSeparator />}
                <MenuItem onClick={() => startSave()}>New palette…</MenuItem>
              </SubMenu>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
      {/* The pair sits under the dropdown, blank-labelled — the row above
          already names the field (ColorTypeRow's reveal idiom). While the
          field is linked it is flanked by the two palette controls, whose
          slots stay open (empty when the colors agree) so an edit never
          shifts the row. */}
      {plainRow(
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
          : undefined,
      )}
    </>
  );
}
