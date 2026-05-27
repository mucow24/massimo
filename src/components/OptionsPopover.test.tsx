import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
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

  it('contains a curve-radius slider that reflects and updates the store', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /curve radius/i });
    expect(slider).toHaveAttribute('min', '4');
    expect(slider).toHaveAttribute('max', '80');
    expect(slider).toHaveValue(String(useDoc.getState().curveRadius));
    fireEvent.change(slider, { target: { value: '42' } });
    expect(useDoc.getState().curveRadius).toBe(42);
  });

  it('contains a font-size slider with bounds [2, 24] that updates the store', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i });
    expect(slider).toHaveAttribute('min', '2');
    expect(slider).toHaveAttribute('max', '24');
    expect(slider).toHaveAttribute('step', '1');
    fireEvent.change(slider, { target: { value: '18' } });
    expect(useDoc.getState().labelFontSize).toBe(18);
  });

  it('contains a font-size spinbutton that mirrors the slider value', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const spin = screen.getByRole('spinbutton', { name: /font size/i });
    expect(spin).toHaveAttribute('min', '2');
    expect(spin).toHaveAttribute('max', '24');
    expect(spin).toHaveAttribute('step', '1');
    fireEvent.change(spin, { target: { value: '7' } });
    expect(useDoc.getState().labelFontSize).toBe(7);
  });

  it('mousewheel on the spinbutton increments and decrements by 1, clamped to bounds', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const spin = screen.getByRole('spinbutton', { name: /font size/i });

    // Start at default 12.
    fireEvent.wheel(spin, { deltaY: -1 });
    expect(useDoc.getState().labelFontSize).toBe(13);
    fireEvent.wheel(spin, { deltaY: 1 });
    fireEvent.wheel(spin, { deltaY: 1 });
    expect(useDoc.getState().labelFontSize).toBe(11);

    // Clamp to MAX.
    useDoc.setState({ ...useDoc.getState(), labelFontSize: 24 });
    fireEvent.wheel(spin, { deltaY: -1 });
    expect(useDoc.getState().labelFontSize).toBe(24);

    // Clamp to MIN.
    useDoc.setState({ ...useDoc.getState(), labelFontSize: 2 });
    fireEvent.wheel(spin, { deltaY: 1 });
    expect(useDoc.getState().labelFontSize).toBe(2);
  });

  it('typing an empty value in the spinbutton leaves the store unchanged; on blur it snaps back', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const spin = screen.getByRole('spinbutton', { name: /font size/i }) as HTMLInputElement;
    fireEvent.change(spin, { target: { value: '' } });
    expect(useDoc.getState().labelFontSize).toBe(12); // unchanged
    fireEvent.blur(spin);
    expect(spin.value).toBe('12'); // re-synced to the store
  });

  it('Weight dropdown lists every shipped Helvetica Neue weight in ascending order', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const select = screen.getByRole('combobox', { name: /weight/i }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => Number(o.value));
    expect(values).toEqual([100, 200, 300, 400, 500, 700, 800, 900]);
  });

  it('Weight dropdown defaults to the store value (400 = Roman)', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const select = screen.getByRole('combobox', { name: /weight/i }) as HTMLSelectElement;
    expect(select.value).toBe('400');
  });

  it('Selecting a weight from the dropdown writes labelWeight to the store', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const select = screen.getByRole('combobox', { name: /weight/i }) as HTMLSelectElement;
    await user.selectOptions(select, '700');
    expect(useDoc.getState().labelWeight).toBe(700);
    await user.selectOptions(select, '300');
    expect(useDoc.getState().labelWeight).toBe(300);
  });

  it('Weight dropdown reflects an externally-changed store value', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 800 });
    render(<Toolbar />);
    // Open the popover via a click on the trigger.
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    const select = screen.getByRole('combobox', { name: /weight/i }) as HTMLSelectElement;
    expect(select.value).toBe('800');
  });

  it('The old Bold toggle button is gone (replaced by the weight dropdown)', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    // No button labelled "Bold" inside the dialog (the only one with /bold/i
    // would have been the old toggle). The italic button stays.
    expect(screen.queryByRole('button', { name: /^bold$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument();
  });

  it('Italic toggle reflects and flips labelItalic', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const italic = screen.getByRole('button', { name: /italic/i });
    expect(italic).toHaveAttribute('aria-pressed', 'false');
    await user.click(italic);
    expect(useDoc.getState().labelItalic).toBe(true);
    await user.click(italic);
    expect(useDoc.getState().labelItalic).toBe(false);
  });

  describe('transfer styling', () => {
    it('contains a Transfer thickness slider with bounds [1, 14] that updates the store', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const slider = screen.getByRole('slider', { name: /transfer thickness/i });
      expect(slider).toHaveAttribute('min', '1');
      expect(slider).toHaveAttribute('max', '14');
      expect(slider).toHaveAttribute('step', '1');
      fireEvent.change(slider, { target: { value: '7' } });
      expect(useDoc.getState().transferThickness).toBe(7);
    });

    it('contains a Transfer thickness spinbutton with no upper bound (accepts arbitrary)', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const spin = screen.getByRole('spinbutton', { name: /transfer thickness/i });
      expect(spin).toHaveAttribute('min', '1');
      // No `max` attribute — the textbox lets users enter thicknesses beyond
      // the slider's range.
      expect(spin).not.toHaveAttribute('max');
      expect(spin).toHaveAttribute('step', '1');
      fireEvent.change(spin, { target: { value: '4' } });
      expect(useDoc.getState().transferThickness).toBe(4);
      // Above the slider max is allowed via the textbox.
      fireEvent.change(spin, { target: { value: '25' } });
      expect(useDoc.getState().transferThickness).toBe(25);
    });

    it('mousewheel on the thickness spinbutton increments freely above the slider max, clamps at MIN', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const spin = screen.getByRole('spinbutton', { name: /transfer thickness/i });

      // Default 2 → 3 → back to 2.
      fireEvent.wheel(spin, { deltaY: -1 });
      expect(useDoc.getState().transferThickness).toBe(3);
      fireEvent.wheel(spin, { deltaY: 1 });
      expect(useDoc.getState().transferThickness).toBe(2);

      // No upper clamp — wheeling up from the slider max keeps incrementing.
      useDoc.setState({ ...useDoc.getState(), transferThickness: 10 });
      fireEvent.wheel(spin, { deltaY: -1 });
      expect(useDoc.getState().transferThickness).toBe(11);

      // Clamp at MIN = 1.
      useDoc.setState({ ...useDoc.getState(), transferThickness: 1 });
      fireEvent.wheel(spin, { deltaY: 1 });
      expect(useDoc.getState().transferThickness).toBe(1);
    });

    it('empty thickness spinbutton input leaves store unchanged; blur snaps back', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const spin = screen.getByRole('spinbutton', {
        name: /transfer thickness/i,
      }) as HTMLInputElement;
      fireEvent.change(spin, { target: { value: '' } });
      expect(useDoc.getState().transferThickness).toBe(2);
      fireEvent.blur(spin);
      expect(spin.value).toBe('2');
    });

    it('contains a Transfer color input (type=color) defaulting to #000000', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      // Native color input — role-based selectors don't surface type=color on
      // all backends, so query by aria-label directly.
      const color = screen.getByLabelText('Transfer color') as HTMLInputElement;
      expect(color.type).toBe('color');
      expect(color.value).toBe('#000000');
      fireEvent.change(color, { target: { value: '#ff0080' } });
      expect(useDoc.getState().transferColor).toBe('#ff0080');
    });

    it('contains a Transfer stroke slider with bounds [0, 5] that updates the store', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const slider = screen.getByRole('slider', { name: /transfer stroke$/i });
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '5');
      expect(slider).toHaveAttribute('step', '1');
      fireEvent.change(slider, { target: { value: '3' } });
      expect(useDoc.getState().transferStrokeWidth).toBe(3);
    });

    it('contains a Transfer stroke spinbutton bounded to [0, 5]', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const spin = screen.getByRole('spinbutton', { name: /transfer stroke$/i });
      expect(spin).toHaveAttribute('min', '0');
      expect(spin).toHaveAttribute('max', '5');
      expect(spin).toHaveAttribute('step', '1');
      fireEvent.change(spin, { target: { value: '2' } });
      expect(useDoc.getState().transferStrokeWidth).toBe(2);
      // Above max → clamped to 5.
      fireEvent.change(spin, { target: { value: '99' } });
      expect(useDoc.getState().transferStrokeWidth).toBe(5);
    });

    it('contains a Transfer stroke color input (type=color) defaulting to #ffffff', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const color = screen.getByLabelText('Transfer stroke color') as HTMLInputElement;
      expect(color.type).toBe('color');
      expect(color.value).toBe('#ffffff');
      fireEvent.change(color, { target: { value: '#123456' } });
      expect(useDoc.getState().transferStrokeColor).toBe('#123456');
    });
  });

  describe('color-palette disclosure', () => {
    it('renders a "Color palettes" disclosure trigger; cards are hidden by default', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const disclosure = screen.getByRole('button', { name: /color palettes/i });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      // No palette checkboxes visible until expanded.
      expect(screen.queryByRole('checkbox', { name: /^MTA$/ })).toBeNull();
    });

    it('expanding reveals one checkbox per palette in PALETTES order', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const disclosure = screen.getByRole('button', { name: /color palettes/i });
      await user.click(disclosure);
      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
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
      await user.click(screen.getByRole('button', { name: /color palettes/i }));
      // Three continents (asia, europe, na) → two separators between them.
      const separators = document.querySelectorAll('.options-palette-separator');
      expect(separators).toHaveLength(2);
    });

    it('default state: only MTA checked, MTA disabled (lone palette)', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await user.click(screen.getByRole('button', { name: /color palettes/i }));
      const mta = screen.getByRole('checkbox', { name: 'MTA' }) as HTMLInputElement;
      const bart = screen.getByRole('checkbox', { name: 'BART' }) as HTMLInputElement;
      const caltrain = screen.getByRole('checkbox', { name: 'Caltrain' }) as HTMLInputElement;
      expect(mta.checked).toBe(true);
      expect(bart.checked).toBe(false);
      expect(caltrain.checked).toBe(false);
      expect(mta.disabled).toBe(true);
      expect(bart.disabled).toBe(false);
      expect(caltrain.disabled).toBe(false);
    });

    it('checking BART updates the store and re-enables the MTA checkbox', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      await user.click(screen.getByRole('button', { name: 'Options' }));
      await user.click(screen.getByRole('button', { name: /color palettes/i }));
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
      await user.click(screen.getByRole('button', { name: /color palettes/i }));
      await user.click(screen.getByRole('checkbox', { name: 'BART' }));
      await user.click(screen.getByRole('checkbox', { name: 'BART' }));
      expect(useDoc.getState().activePalettes).toEqual(['mta']);
      const mta = screen.getByRole('checkbox', { name: 'MTA' }) as HTMLInputElement;
      expect(mta.disabled).toBe(true);
    });
  });
});
