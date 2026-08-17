import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaletteColorRow } from './PaletteColorRow';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { chooseOption } from '../test/interaction';
import type { Palette } from '../model/palettes';
import type { SwatchRef } from '../model/types';

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

const renderRow = (over: Partial<Parameters<typeof PaletteColorRow>[0]> = {}) =>
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
  it('with no design palettes it IS the plain day/night row — zero new chrome', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Fill color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode fill color' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
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
});
