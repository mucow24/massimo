import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaletteColorRow } from './PaletteColorRow';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { chooseOption } from '../test/interaction';
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

describe('<PaletteColorRow />', () => {
  // The swatch ColorFields are buttons; the dropdown trigger is a combobox —
  // role-scoped queries keep the two apart (the row label reaches both).
  //
  // With no design palettes there is nothing to link to, so the dropdown stays
  // away and the row keeps its one-line shape. The save is the ONE control it
  // grows — the offer to start a palette off this color — and the assertion is
  // exhaustive so a third never arrives here unnoticed.
  it('with no design palettes it is the plain day/night row plus the save', () => {
    renderRow();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Fill color',
      'Dark mode fill color',
      'Save fill to a design palette',
    ]);
  });

  it('custom state: dropdown reads Custom and the pair reveals beneath', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    expect(screen.getByRole('combobox', { name: 'Fill color palette color' })).toHaveTextContent(
      'Custom',
    );
    expect(screen.getByRole('button', { name: 'Fill color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode fill color' })).toBeInTheDocument();
  });

  // The pair is always there — linked only changes where the color CAME from,
  // never whether you can reach it.
  it('linked state: the trigger names the swatch, the pair pickers stay', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    expect(screen.getByRole('combobox', { name: 'Fill color palette color' })).toHaveTextContent(
      'Border',
    );
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
      expect(screen.getByRole('combobox', { name: 'Fill color palette color' })).toHaveTextContent(
        'Border',
      );
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
    await chooseOption(user, 'Fill color palette color', 'Border');
    expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#bbbbbb' });
  });

  it('a swatch without a stored night resolves night == day', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow();
    await chooseOption(user, 'Fill color palette color', 'Wash');
    expect(onPick).toHaveBeenCalledWith(
      { palette: 'grays', swatch: 'Wash' },
      { day: '#eeeeee', night: '#eeeeee' },
    );
  });

  it('picking Custom hands back null with the CURRENT pair — the detach gesture', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER, value: '#333333', darkValue: '#bbbbbb' });
    await chooseOption(user, 'Fill color palette color', 'Custom');
    expect(onPick).toHaveBeenCalledWith(null, { day: '#333333', night: '#bbbbbb' });
  });

  it('line palettes never appear in the dropdown', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [...DEFAULT_DOC.palettes, GRAYS] });
    renderRow();
    await user.click(screen.getByRole('combobox', { name: 'Fill color palette color' }));
    expect(screen.queryByRole('option', { name: /Blue/ })).toBeNull();
    expect(await screen.findByRole('option', { name: 'Border' })).toBeInTheDocument();
  });

  /**
   * Save to palette: the Custom state's answer to Sync. A hand-picked color has
   * no swatch to push into, so the same slot offers to MAKE it one — in a
   * palette the map already carries, or in a design palette minted on the spot.
   * The save lands the swatch and links the field to it in one undo entry, so
   * the row comes back naming what it just created.
   */
  describe('save to palette', () => {
    const SAVE = 'Save fill to a design palette';
    // A pair no GRAYS swatch already paints — otherwise the save LINKS to the
    // match instead of appending, which is its own test below.
    const FRESH = { value: '#00ff00', darkValue: '#004400' };
    const FRESH_PAIR = { day: '#00ff00', night: '#004400' };

    const saveInto = async (user: ReturnType<typeof userEvent.setup>, item: string) => {
      await user.click(screen.getByRole('button', { name: SAVE }));
      await user.click(await screen.findByRole('menuitem', { name: item }));
    };
    const items = async () => (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    const designPalette = () => useDoc.getState().palettes.find((p) => p.kind === 'design');

    /**
     * Give `onPick` a REAL doc write, so the grouping and ordering assertions
     * have two writes to reason about. With a bare mock the palette upsert is
     * the only thing that touches the doc, and a "single undo entry" assertion
     * passes just as happily with `beginHistoryGroup` deleted — it proves
     * nothing. Returns the polygon whose fill the row now stands for.
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

    // Sync needs a link and Save needs Custom, so the two never share the slot.
    it('stands in the Custom state, and yields to Sync while linked', () => {
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      const { unmount } = renderRow();
      expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Sync fill/ })).toBeNull();
      unmount();
      renderRow({ swatchRef: BORDER });
      expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
      expect(screen.getByRole('button', { name: 'Sync fill to Border' })).toBeInTheDocument();
    });

    // The whole point of the mint item: a map with no design palette still has
    // to be able to start one, and the plain row stays plain around the button.
    it('is offered on the plain row too, where there is no dropdown at all', () => {
      renderRow();
      expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).toBeNull();
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
        await user.click(screen.getByRole('button', { name: SAVE }));
        const panel = document.querySelector('.menu-panel');
        expect(panel).not.toBeNull();
        expect(panel?.closest('.canvas-host')).toBeNull();
        expect(panel?.closest('.app')).toBe(app);
      } finally {
        app.remove();
      }
    });

    it('lists the design palettes and the mint, never a line palette', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [...DEFAULT_DOC.palettes, GRAYS] });
      renderRow();
      await user.click(screen.getByRole('button', { name: SAVE }));
      expect(await items()).toEqual(['grays', 'New design palette…']);
    });

    it('appends a swatch named after the field, and links the field to it', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow(FRESH);
      await saveInto(user, 'grays');
      expect(designPalette()?.swatches[2]).toEqual({
        name: 'Fill color',
        color: '#00ff00',
        night: '#004400',
      });
      expect(onPick).toHaveBeenCalledWith({ palette: 'grays', swatch: 'Fill color' }, FRESH_PAIR);
    });

    /**
     * Four of the mount sites label the row just "Color" (a text label's, a
     * transfer's), which would fill a palette with "Color", "Color 2"… The
     * ARIA label is distinct by contract, so that is the stem.
     */
    it('names the swatch by the ARIA label, not the visible one', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow({ ...FRESH, label: 'Color', lightAriaLabel: 'Transfer color' });
      await saveInto(user, 'grays');
      expect(designPalette()?.swatches[2].name).toBe('Transfer color');
    });

    // Two swatches under one color are two names for one thing.
    it('links to a swatch already painting this color rather than adding a second', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow(); // #333333 / #bbbbbb — Border's own pair
      await saveInto(user, 'grays');
      expect(designPalette()?.swatches).toHaveLength(2);
      expect(onPick).toHaveBeenCalledWith(BORDER, { day: '#333333', night: '#bbbbbb' });
    });

    // The collapse invariant every other swatch write obeys.
    it('stores no night half when the two halves agree', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      renderRow({ value: '#00ff00', darkValue: '#00ff00' });
      await saveInto(user, 'grays');
      expect(designPalette()?.swatches[2]).toEqual({ name: 'Fill color', color: '#00ff00' });
    });

    // Names are the ref key, so a second save off the same field counts up
    // rather than landing a duplicate the refs could not tell apart.
    it('counts up when the field has been saved here before', async () => {
      const user = userEvent.setup();
      useDoc.setState({
        ...useDoc.getState(),
        palettes: [
          { ...GRAYS, swatches: [...GRAYS.swatches, { name: 'Fill color', color: '#111111' }] },
        ],
      });
      renderRow(FRESH);
      await saveInto(user, 'grays');
      expect(designPalette()?.swatches[3].name).toBe('Fill color 2');
      expect(onPick).toHaveBeenCalledWith({ palette: 'grays', swatch: 'Fill color 2' }, FRESH_PAIR);
    });

    it('mints a DESIGN palette carrying the one color, and links to that', async () => {
      const user = userEvent.setup();
      renderRow(FRESH);
      await saveInto(user, 'New design palette…');
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

    /**
     * The link the save writes RESOLVES: the swatch it names is really in the
     * palette, painting the pair the field paints. That is the end state both
     * writes exist to reach, and it holds through `addPaletteToMap`'s sweep of
     * faithful wearers — which runs over this very palette as the save lands.
     *
     * Not an ordering test. Writing the ref first survives too (the upsert
     * branch never reconciles, and the add branch reconciles against a doc the
     * palette is already in), so there is no red to be had from a swap.
     */
    it('leaves a link that resolves to the swatch it just made', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
      const pid = withRealPick();
      renderRow(FRESH);
      await saveInto(user, 'grays');
      const ref = useDoc.getState().polygons[pid].fillRef;
      expect(ref).toEqual({ palette: 'grays', swatch: 'Fill color' });
      const swatch = designPalette()?.swatches.find((s) => s.name === ref?.swatch);
      expect(swatch).toEqual({ name: 'Fill color', color: '#00ff00', night: '#004400' });
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
      expect(useDoc.temporal.getState().pastStates).toHaveLength(1);
      expect(designPalette()?.swatches).toHaveLength(3);
      act(() => useDoc.temporal.getState().undo());
      expect(designPalette()?.swatches).toHaveLength(2);
      expect(useDoc.getState().polygons[pid].fillRef).toBeUndefined();
    });
  });
});
