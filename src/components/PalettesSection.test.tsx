import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PalettesSection } from './PalettesSection';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { setColorField } from '../test/colorField';
import { makeLine, makePolygon } from '../test/fixtures';
import type { Palette } from '../model/palettes';

const GRAYS: Palette = {
  name: 'grays',
  kind: 'design',
  swatches: [
    { name: 'Border', color: '#333333', night: '#bbbbbb' },
    { name: 'Wash', color: '#eeeeee' },
  ],
};
const INKS: Palette = { name: 'inks', swatches: [{ name: 'Red', color: '#c1272d' }] };

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, palettes: [INKS, GRAYS] });
  useDoc.temporal.getState().clear();
  useCustomPalettes.setState({ palettes: [], starred: [], sort: 'name' });
});

const grays = () => useDoc.getState().palettes.find((p) => p.name === 'grays');

describe('<PalettesSection />', () => {
  // The kinds are separated by their SECTION, so a palette no longer wears a
  // badge to say which it is — the heading it sits under already did.
  it('files each palette under its kind’s section, unbadged', () => {
    render(<PalettesSection />);
    expect(screen.getByText('Line color palettes')).toBeInTheDocument();
    expect(screen.getByText('Design palettes')).toBeInTheDocument();
    expect(screen.queryByText('design')).toBeNull();
    expect(screen.getByText('inks')).toBeInTheDocument();
    expect(screen.getByText('grays')).toBeInTheDocument();
  });

  it('gives a design row day/night fields, a line row one', () => {
    render(<PalettesSection />);
    expect(screen.getByLabelText('inks Red')).toBeInTheDocument();
    expect(screen.queryByLabelText('inks Red dark')).toBeNull();
    expect(screen.getByLabelText('grays Border')).toBeInTheDocument();
    expect(screen.getByLabelText('grays Border dark')).toBeInTheDocument();
  });

  // A palette minted here must arrive WITH a color: the empty-palette licence
  // belongs to the manager's editor (which throws one away on the way out),
  // and the persist merge hook drops any that is stored without one — so an
  // empty mint would vanish on the next reload.
  it('mints a line palette, carrying one color, under a fresh name', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'New line color palette' }));
    const minted = useDoc.getState().palettes.find((p) => p.name === 'New palette');
    expect(minted?.kind).toBeUndefined();
    expect(minted?.swatches).toHaveLength(1);
  });

  it('mints a design palette under its own stem, kind and all', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'New design palette' }));
    const minted = useDoc.getState().palettes.find((p) => p.name === 'New design palette');
    expect(minted?.kind).toBe('design');
    expect(minted?.swatches).toHaveLength(1);
  });

  it('counts a second mint past the first, and lands it in the map alone', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'New line color palette' }));
    await user.click(screen.getByRole('button', { name: 'New line color palette' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual([
      'inks',
      'grays',
      'New palette',
      'New palette 2',
    ]);
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });

  it('renames a palette, rewriting the refs pointing into it', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        P: makePolygon({
          id: 'P',
          fill: '#333333',
          darkFill: '#bbbbbb',
          fillRef: { palette: 'grays', swatch: 'Border' },
        }),
      },
    });
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Rename grays' }));
    const input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'UI grays{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['inks', 'UI grays']);
    expect(useDoc.getState().polygons.P.fillRef).toEqual({
      palette: 'UI grays',
      swatch: 'Border',
    });
  });

  it('adds a color to a palette, named by its position', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Add a color to grays' }));
    expect(grays()?.swatches.map((s) => s.name)).toEqual(['Border', 'Wash', '3']);
  });

  it('duplicates a color in place, both halves, under a counted-up name', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Duplicate grays Border' }));
    expect(grays()?.swatches).toEqual([
      { name: 'Border', color: '#333333', night: '#bbbbbb' },
      { name: 'Border copy', color: '#333333', night: '#bbbbbb' },
      { name: 'Wash', color: '#eeeeee' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Duplicate grays Border' }));
    expect(grays()?.swatches.map((s) => s.name)).toEqual([
      'Border',
      'Border copy 2',
      'Border copy',
      'Wash',
    ]);
  });

  it('deletes a color, dropping the refs that pointed at it and keeping their paint', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        P: makePolygon({
          id: 'P',
          fill: '#333333',
          darkFill: '#bbbbbb',
          fillRef: { palette: 'grays', swatch: 'Border' },
        }),
      },
    });
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Delete grays Border' }));
    expect(grays()?.swatches.map((s) => s.name)).toEqual(['Wash']);
    const p = useDoc.getState().polygons.P;
    expect('fillRef' in p).toBe(false);
    expect(p.fill).toBe('#333333');
  });

  // A palette carries at least one color wherever it comes to rest, so the
  // last row's delete stands disabled rather than emptying it.
  it('will not delete a palette’s last color', () => {
    render(<PalettesSection />);
    expect(screen.getByRole('button', { name: 'Delete inks Red' })).toBeDisabled();
  });

  it('recolors a design half through the store — linked fields follow live', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        P: makePolygon({
          id: 'P',
          fill: '#333333',
          darkFill: '#bbbbbb',
          fillRef: { palette: 'grays', swatch: 'Border' },
        }),
      },
    });
    render(<PalettesSection />);
    await setColorField(user, 'grays Border', '#444444');
    expect(grays()?.swatches[0]).toMatchObject({ color: '#444444', night: '#bbbbbb' });
    expect(useDoc.getState().polygons.P.fill).toBe('#444444');
    await setColorField(user, 'grays Border dark', '#cccccc');
    expect(grays()?.swatches[0]).toMatchObject({ color: '#444444', night: '#cccccc' });
    expect(useDoc.getState().polygons.P.darkFill).toBe('#cccccc');
  });

  it('recolors a LINE palette swatch, sweeping its linked lines', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      lines: {
        L: makeLine({ id: 'L', color: '#c1272d', colorRef: { palette: 'inks', swatch: 'Red' } }),
      },
    });
    render(<PalettesSection />);
    await setColorField(user, 'inks Red', '#00ff00');
    expect(useDoc.getState().lines.L.color).toBe('#00ff00');
  });

  it('renames a swatch, rewriting the refs pointing at it', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        P: makePolygon({
          id: 'P',
          fill: '#333333',
          darkFill: '#bbbbbb',
          fillRef: { palette: 'grays', swatch: 'Border' },
        }),
      },
    });
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Rename grays Border' }));
    const input = screen.getByRole('textbox', { name: 'Color name' });
    await user.clear(input);
    await user.type(input, 'Edge{Enter}');
    expect(grays()?.swatches[0].name).toBe('Edge');
    expect(useDoc.getState().polygons.P.fillRef).toEqual({ palette: 'grays', swatch: 'Edge' });
  });

  it('a rename onto a sibling name is refused — the old name re-renders', async () => {
    const user = userEvent.setup();
    render(<PalettesSection />);
    await user.click(screen.getByRole('button', { name: 'Rename grays Border' }));
    const input = screen.getByRole('textbox', { name: 'Color name' });
    await user.clear(input);
    await user.type(input, 'Wash{Enter}');
    expect(grays()?.swatches.map((s) => s.name)).toEqual(['Border', 'Wash']);
    expect(screen.getByRole('button', { name: 'Rename grays Border' })).toBeInTheDocument();
  });

  // Each section answers for its own kind, so "you have no design palettes" is
  // still said while line palettes fill the list above it.
  it('an empty section says so on its own', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [INKS] });
    render(<PalettesSection />);
    expect(screen.getByText(/no design palettes/i)).toBeInTheDocument();
    expect(screen.queryByText(/no line color palettes/i)).toBeNull();
  });
});
