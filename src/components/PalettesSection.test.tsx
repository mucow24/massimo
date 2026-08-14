import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PalettesSection } from './PalettesSection';
import { useDoc } from '../state/store';
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
});

const grays = () => useDoc.getState().palettes.find((p) => p.name === 'grays');

describe('<PalettesSection />', () => {
  it('lists every doc palette, design ones badged, with day(/night) fields per row', () => {
    render(<PalettesSection />);
    expect(screen.getByText('inks')).toBeInTheDocument();
    expect(screen.getByText('grays')).toBeInTheDocument();
    expect(screen.getByText('design')).toBeInTheDocument();
    // A line swatch has one field; a design swatch has a dark twin.
    expect(screen.getByLabelText('inks Red')).toBeInTheDocument();
    expect(screen.queryByLabelText('inks Red dark')).toBeNull();
    expect(screen.getByLabelText('grays Border')).toBeInTheDocument();
    expect(screen.getByLabelText('grays Border dark')).toBeInTheDocument();
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

  it('with no palettes, says so instead of rendering nothing', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    render(<PalettesSection />);
    expect(screen.getByText(/carries no palettes/)).toBeInTheDocument();
  });
});
