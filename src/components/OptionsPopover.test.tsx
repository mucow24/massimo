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

  it('Bold toggle reflects and flips labelBold', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const bold = screen.getByRole('button', { name: /bold/i });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await user.click(bold);
    expect(useDoc.getState().labelBold).toBe(true);
    expect(bold).toHaveAttribute('aria-pressed', 'true');
    await user.click(bold);
    expect(useDoc.getState().labelBold).toBe(false);
    expect(bold).toHaveAttribute('aria-pressed', 'false');
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
