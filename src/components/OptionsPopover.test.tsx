import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseOption } from '../test/interaction';
import { Toolbar } from './Toolbar';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useCustomPalettes.setState({ palettes: [] });
});

describe('<OptionsPopover />', () => {
  it('renders an Options trigger to the right of "Snap to all" with a divider between them', () => {
    render(<Toolbar />);
    const options = screen.getByRole('button', { name: 'Options' });
    expect(options).toBeInTheDocument();
    expect(options).toHaveClass('tool-btn');

    // DOM order: Snap-to-all → tool-group-divider → Options.
    const snapAll = screen.getByRole('button', { name: 'Snap to all' });
    const all = Array.from(document.querySelectorAll('.tool-btn, .tool-group-divider'));
    const iSnapAll = all.indexOf(snapAll);
    const iOptions = all.indexOf(options);
    expect(iSnapAll).toBeGreaterThanOrEqual(0);
    expect(iOptions).toBeGreaterThan(iSnapAll);

    // Between them: a divider element.
    const between = all.slice(iSnapAll + 1, iOptions);
    expect(between.some((el) => el.classList.contains('tool-group-divider'))).toBe(true);
  });

  it('is closed by default', () => {
    render(<Toolbar />);
    const options = screen.getByRole('button', { name: 'Options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on click and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const options = screen.getByRole('button', { name: 'Options' });
    await user.click(options);
    expect(options).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: /options/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(options).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Toolbar />
        <button data-testid="outside">outside</button>
      </div>,
    );
    const options = screen.getByRole('button', { name: 'Options' });
    await user.click(options);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the toolbar exposes no range input while the popover is closed', () => {
    render(<Toolbar />);
    // The old inline "Curve r" slider must be gone; no range input should be
    // visible in the toolbar until the user opens the popover.
    expect(document.querySelector('.toolbar input[type="range"]')).toBeNull();
  });

  it('no longer exposes a curve-radius slider (it moved to per-line styles)', async () => {
    // Curve radius is a per-line style field now — edited in the line
    // inspector and line style presets, not as a map-wide option.
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.queryByRole('slider', { name: /curve radius/i })).toBeNull();
  });

  it('no longer exposes station-label font controls (they moved to per-station styles)', async () => {
    // Font size / weight / italic / leading / tracking are per-station now
    // (the station popover + the Default station style). Options is only the
    // palette picker.
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.queryByRole('slider', { name: /font size/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /weight/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /italic/i })).toBeNull();
    expect(screen.queryByRole('slider', { name: /leading/i })).toBeNull();
    expect(screen.queryByRole('slider', { name: /tracking/i })).toBeNull();
  });

  describe('branch inner edges', () => {
    it("defaults to 'both' (shown on the field-select trigger)", async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      // Radix Select trigger is a combobox button; the current value shows as its
      // text (Select.Value), not a native <select> value.
      const select = screen.getByRole('combobox', { name: /branch inner edges/i });
      expect(select).toHaveTextContent('Both');
    });

    it('selecting a mode writes it to the doc', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await chooseOption(user, /branch inner edges/i, 'Curved only');
      expect(useDoc.getState().seamEdges).toBe('curved');
      await chooseOption(user, /branch inner edges/i, 'Straight only');
      expect(useDoc.getState().seamEdges).toBe('straight');
    });
  });

  describe('color palettes', () => {
    it('shows the palette cards directly — no disclosure to expand', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      expect(screen.queryByRole('button', { name: /color palettes/i })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'MTA' })).toBeInTheDocument();
    });

    it('opening the popover reveals one checkbox per palette in PALETTES order', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const checkboxes = screen.getAllByRole('checkbox');
      const names = checkboxes.map((c) => c.getAttribute('aria-label'));
      expect(names).toEqual([
        // Asia
        'Beijing Subway',
        'MTR',
        'Shanghai Metro',
        'Tokyo Subway',
        // Europe
        'Berlin U-Bahn',
        'Paris (RATP)',
        'TfL (London)',
        // North America
        'BART',
        'Caltrain',
        'CTA',
        'LA Metro',
        'MBTA',
        'MTA',
        'MUNI',
        'WMATA',
      ]);
    });

    it('renders a horizontal separator between each pair of adjacent continents', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      // Three continents (asia, europe, na) → two separators between them.
      const separators = document.querySelectorAll('.options-palette-separator');
      expect(separators).toHaveLength(2);
    });

    it('default state: only MTA checked, MTA disabled (lone palette)', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const mta = screen.getByRole('checkbox', { name: 'MTA' });
      const bart = screen.getByRole('checkbox', { name: 'BART' });
      const caltrain = screen.getByRole('checkbox', { name: 'Caltrain' });
      expect(mta).toBeChecked();
      expect(bart).not.toBeChecked();
      expect(caltrain).not.toBeChecked();
      expect(mta).toBeDisabled();
      expect(bart).toBeEnabled();
      expect(caltrain).toBeEnabled();
    });

    it('checking BART updates the store and re-enables the MTA checkbox', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await user.click(screen.getByRole('checkbox', { name: 'BART' }));
      // Stored in canonical order — BART precedes MTA in N. America.
      expect(useDoc.getState().activePalettes).toEqual(['bart', 'mta']);
      const mta = screen.getByRole('checkbox', { name: 'MTA' }) as HTMLInputElement;
      expect(mta.disabled).toBe(false);
    });

    it('unchecking BART after re-checking returns to lone-MTA + disabled state', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await user.click(screen.getByRole('checkbox', { name: 'BART' }));
      await user.click(screen.getByRole('checkbox', { name: 'BART' }));
      expect(useDoc.getState().activePalettes).toEqual(['mta']);
      const mta = screen.getByRole('checkbox', { name: 'MTA' }) as HTMLInputElement;
      expect(mta.disabled).toBe(true);
    });
  });

  describe('custom palettes', () => {
    const frrfFile = () =>
      new File(
        [
          JSON.stringify({
            name: 'frrf',
            colors: [
              { line: 1, human: '#c1272d' },
              { line: 2, human: '#0061a8' },
            ],
          }),
        ],
        'frrf.json',
        { type: 'application/json' },
      );

    const openPalettes = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Options' }));
    };

    it('shows a "Load palette…" button at the top of the palette list', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      expect(screen.getByRole('button', { name: /load palette/i })).toBeInTheDocument();
    });

    it('loads a palette file, adding an unchecked custom card with its swatches', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      fireEvent.change(screen.getByLabelText('Load palette file'), {
        target: { files: [frrfFile()] },
      });
      const checkbox = await screen.findByRole('checkbox', { name: 'frrf' });
      expect(checkbox).not.toBeChecked(); // added unchecked
      expect(useCustomPalettes.getState().palettes[0].swatches).toHaveLength(2);
      // Loading does not mutate the doc's active set.
      expect(useDoc.getState().activePalettes).toEqual(['mta']);
    });

    it('checking a custom palette activates it in the doc', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      fireEvent.change(screen.getByLabelText('Load palette file'), {
        target: { files: [frrfFile()] },
      });
      await user.click(await screen.findByRole('checkbox', { name: 'frrf' }));
      expect(useDoc.getState().activePalettes).toContain('custom:frrf');
    });

    it('the red × button deletes the custom palette', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      fireEvent.change(screen.getByLabelText('Load palette file'), {
        target: { files: [frrfFile()] },
      });
      await screen.findByRole('checkbox', { name: 'frrf' });
      await user.click(screen.getByRole('button', { name: 'Delete frrf' }));
      expect(screen.queryByRole('checkbox', { name: 'frrf' })).toBeNull();
      expect(useCustomPalettes.getState().palettes).toEqual([]);
    });

    it('shows an inline error for an invalid palette file', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      const bad = new File(['{not json'], 'bad.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText('Load palette file'), { target: { files: [bad] } });
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(useCustomPalettes.getState().palettes).toEqual([]);
    });

    it('the load-error banner does not survive close/reopen', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await openPalettes(user);
      const bad = new File(['{not json'], 'bad.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText('Load palette file'), { target: { files: [bad] } });
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      // Close via the Options trigger, reopen: no load was attempted, so no
      // stale error should greet the user.
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await openPalettes(user);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
