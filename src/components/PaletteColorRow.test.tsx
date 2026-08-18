import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaletteColorRow } from './PaletteColorRow';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { Palette } from '../model/palettes';
import type { DayNightColor, SwatchRef } from '../model/types';

const GRAYS: Palette = {
  name: 'grays',
  kind: 'design',
  swatches: [
    { name: 'Border', color: '#333333', night: '#bbbbbb' },
    { name: 'Wash', color: '#eeeeee' },
  ],
};
const BORDER: SwatchRef = { palette: 'grays', swatch: 'Border' };

const onChange = vi.fn();
const onDarkChange = vi.fn();
const onPick = vi.fn();

const renderRow = (
  over: Partial<Parameters<typeof PaletteColorRow>[0]> = {},
  options?: Parameters<typeof render>[1],
) =>
  render(
    <PaletteColorRow
      label="Fill color"
      id="fill"
      darkId="dark-fill"
      lightAriaLabel="Fill color"
      darkAriaLabel="Dark mode fill color"
      titleNoun="fill"
      value="#333333"
      darkValue="#bbbbbb"
      swatchRef={undefined}
      onChange={onChange}
      onDarkChange={onDarkChange}
      onPick={onPick}
      {...over}
    />,
    options,
  );

beforeEach(() => {
  localStorage.clear();
  onChange.mockReset();
  onDarkChange.mockReset();
  onPick.mockReset();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

/**
 * Drive one of the row's two ColorFields for real: open its picker and type a
 * hex. Role-scoped rather than `setColorField`, because the row's `<label>`
 * carries the same accessible name as the swatch it sits beside.
 */
const editSwatch = async (user: ReturnType<typeof userEvent.setup>, name: string, hex: string) => {
  await user.click(screen.getByRole('button', { name }));
  fireEvent.change(screen.getByLabelText(`${name} hex value`), { target: { value: hex } });
};

/** The dropdown is a MENU, not a select: its trigger is a button and its swatch
 *  rows are `menuitemradio` (the current one `aria-checked`). */
const trigger = (name = 'Fill color palette color') => screen.getByRole('button', { name });
const openMenu = (user: ReturnType<typeof userEvent.setup>, name?: string) =>
  user.click(trigger(name));

/** Open the dropdown and choose a swatch (or the Custom row). */
const pickSwatch = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await openMenu(user);
  await user.click(await screen.findByRole('menuitemradio', { name }));
};

describe('<PaletteColorRow />', () => {
  // The swatch ColorFields are buttons and so is the dropdown trigger, so the
  // aria-label is what keeps them apart (the row label reaches both).
  /**
   * The dropdown is ALWAYS here now, even with nothing to link to: it carries
   * Save color to palette, whose submenu always offers to mint one. That is
   * what earns it its place on a map holding no design palette — the row used
   * to collapse to the plain pair here, because a dropdown with only Custom in
   * it said nothing. The assertion is exhaustive so no stray control (the old
   * trailing save button among them) arrives here unnoticed.
   */
  it('keeps its dropdown with no design palettes — the save lives in it', () => {
    renderRow();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Fill color palette color',
      'Fill color',
      'Dark mode fill color',
    ]);
  });

  it('custom state: dropdown reads Custom and the pair reveals beneath', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    expect(trigger()).toHaveTextContent('Custom');
    expect(screen.getByRole('button', { name: 'Fill color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode fill color' })).toBeInTheDocument();
  });

  // The pair is always there — linked only changes where the color CAME from,
  // never whether you can reach it.
  it('linked state: the trigger names the swatch, the pair pickers stay', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    expect(trigger()).toHaveTextContent('Border');
    expect(screen.getByRole('button', { name: 'Fill color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode fill color' })).toBeInTheDocument();
  });

  // Nothing diverges, so there is nothing to put back and nothing to push:
  // the revert is absent and Sync stands idle, the same reading the style
  // row's own Sync button has while an item matches its style.
  it('a link painting its swatch has no revert, and Sync sits idle', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    expect(screen.queryByRole('button', { name: /^Reset fill/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sync fill to Border' })).toBeDisabled();
  });

  // THE gesture the whole feature exists for, driven end to end: link a field,
  // then edit its picker. It must write the new color WITH the same ref — a
  // value written without the ref key is the detach gesture, which would drop
  // the row back to Custom and make the dirty state unreachable.
  it('editing a picker while linked keeps the link (does NOT fall back to Custom)', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    await editSwatch(user, 'Fill color', '#00ff00');
    expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#00ff00', night: '#bbbbbb' });
    // Never the bare value write — that is what unlinks.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('editing the DARK picker while linked keeps the link too', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    await editSwatch(user, 'Dark mode fill color', '#00ff00');
    expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#00ff00' });
    expect(onDarkChange).not.toHaveBeenCalled();
  });

  // Unlinked, the pickers still write plain values — that is how a Custom
  // color is edited, and how a detach stays detached.
  it('editing a picker while UNLINKED writes the plain value', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    await editSwatch(user, 'Fill color', '#00ff00');
    expect(onChange).toHaveBeenCalledWith('#00ff00');
    expect(onPick).not.toHaveBeenCalled();
  });

  describe('a linked field recolored in place', () => {
    // The row still says Border, but paints something else.
    const dirtyRow = () => {
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow({ swatchRef: BORDER, value: '#00ff00', darkValue: '#00ff00' });
    };

    it('keeps naming its swatch and offers reset + sync', () => {
      dirtyRow();
      expect(trigger()).toHaveTextContent('Border');
      expect(screen.getByRole('button', { name: 'Reset fill to Border' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sync fill to Border' })).toBeInTheDocument();
    });

    it('reset restamps the swatch back over the local color, link intact', async () => {
      const user = userEvent.setup();
      dirtyRow();
      await user.click(screen.getByRole('button', { name: 'Reset fill to Border' }));
      expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#bbbbbb' });
    });

    it('sync writes the local pair into the swatch itself', async () => {
      const user = userEvent.setup();
      dirtyRow();
      await user.click(screen.getByRole('button', { name: 'Sync fill to Border' }));
      expect(useDoc.getState().palettes[0].swatches[0]).toEqual({
        name: 'Border',
        color: '#00ff00',
      });
      // The field itself is left alone — it already paints this.
      expect(onPick).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it('picking a swatch hands over its ref and resolved pair', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    await pickSwatch(user, 'Border');
    expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#bbbbbb' });
  });

  it('a swatch without a stored night resolves night == day', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    await pickSwatch(user, 'Wash');
    expect(onPick).toHaveBeenCalledWith(
      { palette: 'grays', swatch: 'Wash' },
      { day: '#eeeeee', night: '#eeeeee' },
    );
  });

  it('picking Custom hands back null with the CURRENT pair — the detach gesture', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER, value: '#333333', darkValue: '#bbbbbb' });
    await pickSwatch(user, 'Custom');
    expect(onPick).toHaveBeenCalledWith(null, { day: '#333333', night: '#bbbbbb' });
  });

  it('line palettes never appear in the dropdown', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [...DEFAULT_DOC.palettes, GRAYS] });
    renderRow();
    await openMenu(user);
    expect(screen.queryByRole('menuitemradio', { name: /Blue/ })).toBeNull();
    expect(await screen.findByRole('menuitemradio', { name: 'Border' })).toBeInTheDocument();
  });

  /**
   * Save color to palette: the color pickers' half of the one save idiom the
   * Styles tab's "Save style…" set. It sits at the foot of the dropdown behind
   * a flyout of the map's design palettes, and choosing one opens an inline
   * name field — nothing reaches the doc until that name commits, so Escape
   * anywhere in the chain leaves the map exactly as it was.
   *
   * The name is what decides between the two outcomes, the same way a style
   * name does: an existing swatch's name REDEFINES that swatch (and carries
   * its faithful wearers along), any other name appends a new one. That is
   * what makes "save a copy" reachable from a field that is already linked.
   */
  describe('save color to palette', () => {
    // A pair no GRAYS swatch already paints — so the seeded name is the field's
    // own stem rather than a matching swatch's (its own test, below).
    const FRESH = { value: '#00ff00', darkValue: '#004400' };
    const FRESH_PAIR = { day: '#00ff00', night: '#004400' };

    const openSave = async (user: ReturnType<typeof userEvent.setup>, name?: string) => {
      await openMenu(user, name);
      const trig = await screen.findByRole('menuitem', { name: 'Save color to palette' });
      await user.hover(trig);
      await waitFor(() => expect(trig).toHaveAttribute('aria-expanded', 'true'));
    };
    /**
     * Through the flyout and onto the name field, which is left open.
     *
     * By KEYBOARD, because jsdom's zero-size layout defeats Radix's hover-grace
     * polygon: moving the pointer off the sub trigger and onto a flyout item
     * reads as leaving the submenu, which closes before the click can land
     * (the same reason Menu.test.tsx drives its own flyouts this way). The
     * pointer path is covered in the Playwright suite, in a real browser.
     */
    const saveInto = async (
      user: ReturnType<typeof userEvent.setup>,
      item: string,
      name?: string,
    ) => {
      await openSave(user, name);
      await user.keyboard('{ArrowRight}');
      for (let i = 0; i < 12 && document.activeElement?.textContent !== item; i++)
        await user.keyboard('{ArrowDown}');
      expect(document.activeElement?.textContent).toBe(item);
      await user.keyboard('{Enter}');
    };
    const saveItems = async () => {
      const trig = await screen.findByRole('menuitem', { name: 'Save color to palette' });
      return (await screen.findAllByRole('menuitem'))
        .filter((el) => el !== trig)
        .map((el) => el.textContent);
    };
    const nameField = (label: string) => screen.getByRole('textbox', { name: label });
    const designPalette = () => useDoc.getState().palettes.find((p) => p.kind === 'design');

    /**
     * Give `onPick` a REAL doc write, so the grouping assertions have two
     * writes to reason about. With a bare mock the palette upsert is the only
     * thing touching the doc, and a "single undo entry" assertion passes just
     * as happily with `beginHistoryGroup` deleted — it proves nothing. Returns
     * the polygon whose fill the row now stands for.
     */
    const withRealPick = (): string => {
      const pid = useDoc.getState().addPolygon(0, 0);
      onPick.mockImplementation((ref: SwatchRef | null, pair: DayNightColor) =>
        useDoc.getState().updatePolygon(pid, {
          fill: pair.day,
          darkFill: pair.night,
          fillRef: ref ?? undefined,
        }),
      );
      return pid;
    };

    /**
     * Offered in BOTH states, which is the whole of "save a copy": a linked
     * field saved under a fresh name becomes a second swatch rather than
     * overwriting the one it wears. The old row put the save in the trailing
     * slot, where Sync stood while linked and the two could never coexist.
     */
    it('is offered while linked, not only while Custom', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow({ swatchRef: BORDER });
      await openMenu(user);
      expect(
        await screen.findByRole('menuitem', { name: 'Save color to palette' }),
      ).toBeInTheDocument();
    });

    it('lists the design palettes and the mint, never a line palette', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [...DEFAULT_DOC.palettes, GRAYS] });
      renderRow();
      await openSave(user);
      expect(await saveItems()).toEqual(['grays', 'New palette…']);
    });

    // The reason the dropdown may stand on a map holding no design palette at
    // all: the flyout is never empty, so the row is never a dead end.
    it('offers the mint alone when the map carries no design palette', async () => {
      const user = userEvent.setup();
      renderRow();
      await openSave(user);
      expect(await saveItems()).toEqual(['New palette…']);
    });

    /**
     * `.canvas-host` is an `isolation: isolate` layer: a panel left inside it
     * paints BENEATH the sidebar, whatever its z-index. So the menu portals to
     * `.app`, which is also where the design tokens and the dark-mode
     * reassignment live — a panel in `<body>` renders unthemed.
     *
     * The container must be known by the time Content MOUNTS. Radix fires
     * `onOpenChange` from a passive effect, a commit too late, so resolving it
     * there would put the first frame in `<body>` and then remount the whole
     * subtree underneath the real container.
     */
    it('portals its menu into .app, clear of the canvas isolate layer', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      const app = document.createElement('div');
      app.className = 'app';
      const host = document.createElement('div');
      host.className = 'canvas-host';
      app.append(host);
      document.body.append(app);
      try {
        renderRow({}, { container: host });
        await openMenu(user);
        const panel = document.querySelector('.menu-panel');
        expect(panel).not.toBeNull();
        expect(panel?.closest('.canvas-host')).toBeNull();
        expect(panel?.closest('.app')).toBe(app);
      } finally {
        app.remove();
      }
    });

    describe('into a palette the map already carries', () => {
      const intoGrays = async (user: ReturnType<typeof userEvent.setup>) => {
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow(FRESH);
        await saveInto(user, 'grays');
      };

      // Name FIRST: the palette is untouched until the name commits, which is
      // what lets Escape leave nothing behind.
      it('opens a name field seeded with the field name, writing nothing yet', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        expect(nameField('Color name')).toHaveValue('Fill color');
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(onPick).not.toHaveBeenCalled();
      });

      it('Enter appends the swatch under that name and links the field to it', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()?.swatches[2]).toEqual({
          name: 'Fill color',
          color: '#00ff00',
          night: '#004400',
        });
        expect(onPick).toHaveBeenCalledWith({ palette: 'grays', swatch: 'Fill color' }, FRESH_PAIR);
      });

      it('a typed name is the one the swatch takes', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        await user.clear(nameField('Color name'));
        await user.type(nameField('Color name'), 'Signal{Enter}');
        expect(designPalette()?.swatches[2].name).toBe('Signal');
        expect(onPick).toHaveBeenCalledWith({ palette: 'grays', swatch: 'Signal' }, FRESH_PAIR);
      });

      it('Escape writes nothing at all', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        await user.type(nameField('Color name'), '{Escape}');
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(onPick).not.toHaveBeenCalled();
      });

      it('an emptied name cancels, like every other inline rename', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        await user.clear(nameField('Color name'));
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(onPick).not.toHaveBeenCalled();
      });

      // The collapse invariant every other swatch write obeys.
      it('stores no night half when the two halves agree', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow({ value: '#00ff00', darkValue: '#00ff00' });
        await saveInto(user, 'grays');
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()?.swatches[2]).toEqual({ name: 'Fill color', color: '#00ff00' });
      });

      /**
       * Four of the mount sites label the row just "Color" (a text label's, a
       * transfer's), which would fill a palette with "Color", "Color 2"… The
       * ARIA label is distinct by contract, so that is the stem.
       */
      it('seeds the name from the ARIA label, not the visible one', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow({ ...FRESH, label: 'Color', lightAriaLabel: 'Transfer color' });
        await saveInto(user, 'grays', 'Color palette color');
        expect(nameField('Color name')).toHaveValue('Transfer color');
      });

      // Names are the ref key, so the seed shows the name the save will really
      // land on rather than promising one the dedupe would then move.
      it('seeds a counted-up name when the field has been saved here before', async () => {
        const user = userEvent.setup();
        useDoc.setState({
          ...useDoc.getState(),
          palettes: [
            { ...GRAYS, swatches: [...GRAYS.swatches, { name: 'Fill color', color: '#111111' }] },
          ],
        });
        renderRow(FRESH);
        await saveInto(user, 'grays');
        expect(nameField('Color name')).toHaveValue('Fill color 2');
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()?.swatches[3].name).toBe('Fill color 2');
      });

      /**
       * Typing a name a swatch already holds REDEFINES it — the styles rule,
       * one level down, and the same write the Sync button makes. Two swatches
       * cannot share a name (it is the ref key), so the alternative would be a
       * silent count-up onto a name the user did not ask for.
       */
      it('a name already in the palette redefines that swatch instead of adding', async () => {
        const user = userEvent.setup();
        await intoGrays(user);
        await user.clear(nameField('Color name'));
        await user.type(nameField('Color name'), 'Border{Enter}');
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(designPalette()?.swatches[0]).toEqual({
          name: 'Border',
          color: '#00ff00',
          night: '#004400',
        });
        expect(onPick).toHaveBeenCalledWith(BORDER, FRESH_PAIR);
      });

      /**
       * A color the palette already paints seeds THAT swatch's name, so Enter
       * links to it rather than laying a second swatch over the same color —
       * the tidiness the old silent match protected. Typing over the seed is
       * how you get the copy instead.
       */
      it('seeds the matching swatch’s name when the color is already in there', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow(); // #333333 / #bbbbbb — Border's own pair
        await saveInto(user, 'grays');
        expect(nameField('Color name')).toHaveValue('Border');
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#bbbbbb' });
      });

      // The palette write and the field's link are one gesture: undo must not
      // leave a swatch behind that nothing points at.
      it('is a single undo entry, and undo takes back BOTH writes', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        const pid = withRealPick();
        renderRow(FRESH);
        useDoc.temporal.getState().clear();
        await saveInto(user, 'grays');
        await user.type(nameField('Color name'), '{Enter}');
        expect(useDoc.temporal.getState().pastStates).toHaveLength(1);
        expect(designPalette()?.swatches).toHaveLength(3);
        act(() => useDoc.temporal.getState().undo());
        expect(designPalette()?.swatches).toHaveLength(2);
        expect(useDoc.getState().polygons[pid].fillRef).toBeUndefined();
      });

      /**
       * The link the save writes RESOLVES: the swatch it names is really in the
       * palette, painting the pair the field paints. That is the end state both
       * writes exist to reach, and it holds through `addPaletteToMap`'s sweep
       * of faithful wearers — which runs over this very palette as the save
       * lands.
       */
      it('leaves a link that resolves to the swatch it just made', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        const pid = withRealPick();
        renderRow(FRESH);
        await saveInto(user, 'grays');
        await user.type(nameField('Color name'), '{Enter}');
        const ref = useDoc.getState().polygons[pid].fillRef;
        expect(ref).toEqual({ palette: 'grays', swatch: 'Fill color' });
        expect(designPalette()?.swatches.find((s) => s.name === ref?.swatch)).toEqual({
          name: 'Fill color',
          color: '#00ff00',
          night: '#004400',
        });
      });
    });

    describe('into a palette minted on the spot', () => {
      const intoNew = async (user: ReturnType<typeof userEvent.setup>) => {
        renderRow(FRESH);
        await saveInto(user, 'New palette…');
      };

      it('asks for the palette name first, seeded and writing nothing', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        expect(nameField('Palette name')).toHaveValue('New design palette');
        expect(designPalette()).toBeUndefined();
      });

      // The chain: palette name, then color name, and only THEN the write.
      it('Enter moves on to the color name, still writing nothing', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.type(nameField('Palette name'), '{Enter}');
        expect(nameField('Color name')).toHaveValue('Fill color');
        expect(designPalette()).toBeUndefined();
        expect(onPick).not.toHaveBeenCalled();
      });

      it('the second Enter mints the palette carrying the one color, and links', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.type(nameField('Palette name'), '{Enter}');
        await user.type(nameField('Color name'), '{Enter}');
        expect(designPalette()).toEqual({
          name: 'New design palette',
          kind: 'design',
          swatches: [{ name: 'Fill color', color: '#00ff00', night: '#004400' }],
        });
        expect(onPick).toHaveBeenCalledWith(
          { palette: 'New design palette', swatch: 'Fill color' },
          FRESH_PAIR,
        );
      });

      it('both names are the typed ones', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.clear(nameField('Palette name'));
        await user.type(nameField('Palette name'), 'Brand{Enter}');
        await user.clear(nameField('Color name'));
        await user.type(nameField('Color name'), 'Signal{Enter}');
        expect(designPalette()?.name).toBe('Brand');
        expect(designPalette()?.swatches[0].name).toBe('Signal');
        expect(onPick).toHaveBeenCalledWith({ palette: 'Brand', swatch: 'Signal' }, FRESH_PAIR);
      });

      // Nothing has been written yet at either stage, so bailing out of the
      // second one must not leave an empty palette standing.
      it('Escape at the COLOR stage leaves no palette behind', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.type(nameField('Palette name'), '{Enter}');
        await user.type(nameField('Color name'), '{Escape}');
        expect(designPalette()).toBeUndefined();
        expect(onPick).not.toHaveBeenCalled();
      });

      it('Escape at the PALETTE stage ends the chain there', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.type(nameField('Palette name'), '{Escape}');
        expect(screen.queryByRole('textbox', { name: 'Color name' })).toBeNull();
        expect(designPalette()).toBeUndefined();
      });

      /**
       * Clicking away mid-chain ABANDONS rather than advancing. The other
       * inline renames in the app commit on blur, and the last stage of this
       * one does too — but advancing here would mount the next field with
       * `autoFocus` and snatch focus back out of whatever was just clicked.
       */
      it('clicking away at the palette stage abandons the save', async () => {
        const user = userEvent.setup();
        await intoNew(user);
        await user.click(screen.getByRole('button', { name: 'Fill color' }));
        expect(screen.queryByRole('textbox', { name: 'Color name' })).toBeNull();
        expect(designPalette()).toBeUndefined();
      });

      /**
       * The Enter flag is per-attempt, not per-row. A save committed with Enter
       * leaves it set, and a LATER chain abandoned by clicking away would read
       * that stale true and advance to the color field anyway — mounting it
       * under the cursor that had just left.
       */
      it('a previous Enter does not make a later click-away advance', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow(FRESH);
        await saveInto(user, 'grays');
        await user.type(nameField('Color name'), '{Enter}'); // sets the flag
        await saveInto(user, 'New palette…');
        await user.click(screen.getByRole('button', { name: 'Fill color' }));
        expect(screen.queryByRole('textbox', { name: 'Color name' })).toBeNull();
        expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['grays']);
      });

      /**
       * `addPaletteToMap` REPLACES a palette of the same name — that is the
       * refresh semantic the library re-add needs. Reached through a typed
       * name it would silently destroy every other swatch in the palette and
       * drop their refs, so a name the map already holds appends instead.
       */
      it('a typed name the map already holds appends rather than replacing it', async () => {
        const user = userEvent.setup();
        useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
        renderRow(FRESH);
        await saveInto(user, 'New palette…');
        await user.clear(nameField('Palette name'));
        await user.type(nameField('Palette name'), 'grays{Enter}');
        await user.type(nameField('Color name'), '{Enter}');
        expect(useDoc.getState().palettes.filter((p) => p.name === 'grays')).toHaveLength(1);
        expect(designPalette()?.swatches.map((s) => s.name)).toEqual([
          'Border',
          'Wash',
          'Fill color',
        ]);
      });

      it('is a single undo entry across both writes', async () => {
        const user = userEvent.setup();
        const pid = withRealPick();
        renderRow(FRESH);
        useDoc.temporal.getState().clear();
        await saveInto(user, 'New palette…');
        await user.type(nameField('Palette name'), '{Enter}');
        await user.type(nameField('Color name'), '{Enter}');
        expect(useDoc.temporal.getState().pastStates).toHaveLength(1);
        act(() => useDoc.temporal.getState().undo());
        expect(designPalette()).toBeUndefined();
        expect(useDoc.getState().polygons[pid].fillRef).toBeUndefined();
      });
    });
  });
});
