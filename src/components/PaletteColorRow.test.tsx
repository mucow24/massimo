import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('linked state: the trigger names the swatch and the pair pickers are gone', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [GRAYS] });
    renderRow({ swatchRef: BORDER });
    expect(screen.getByRole('combobox', { name: 'Fill color palette color' })).toHaveTextContent(
      'Border',
    );
    expect(screen.queryByRole('button', { name: 'Fill color' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dark mode fill color' })).toBeNull();
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
