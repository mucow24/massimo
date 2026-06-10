import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationShapePicker } from './StationShapePicker';

describe('<StationShapePicker />', () => {
  it('trigger has aria-disabled=true when disabled prop is true; click does not open the menu', async () => {
    const user = userEvent.setup();
    render(<StationShapePicker disabled currentShape="filled-black" onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('trigger is enabled when disabled=false; clicking opens a menu with 10 menuitems', async () => {
    const user = userEvent.setup();
    render(<StationShapePicker disabled={false} currentShape="filled-black" onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger).toHaveAttribute('aria-disabled', 'false');
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(10);
  });

  it('menu items carry human-readable aria-labels for every shape', async () => {
    const user = userEvent.setup();
    render(<StationShapePicker disabled={false} currentShape="filled-black" onPick={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menuitem', { name: 'Filled black' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open black' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Filled black with white stroke' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled white' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open white' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Filled white with black stroke' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled line color' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled black diamond' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled white diamond' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'None' })).toBeInTheDocument();
  });

  it('previews the filled-line-color option in the provided lineColor', async () => {
    const user = userEvent.setup();
    render(
      <StationShapePicker
        disabled={false}
        currentShape="filled-black"
        lineColor="#e6002d"
        onPick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    const item = screen.getByRole('menuitem', { name: 'Filled line color' });
    expect(item.querySelector('circle')?.getAttribute('fill')).toBe('#e6002d');
  });

  it('trigger renders the currentShape glyph (filled-line-color → lineColor-fill circle)', () => {
    render(
      <StationShapePicker
        disabled={false}
        currentShape="filled-line-color"
        lineColor="#0055ff"
        onPick={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger.querySelector('circle')?.getAttribute('fill')).toBe('#0055ff');
  });

  it('clicking a menu item calls onPick with that shape and closes the menu', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StationShapePicker disabled={false} currentShape="filled-black" onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filled black diamond' }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('filled-black-diamond');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('trigger renders the currentShape glyph (diamond → polygon)', () => {
    render(
      <StationShapePicker disabled={false} onPick={vi.fn()} currentShape="filled-black-diamond" />,
    );
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger.querySelector('polygon')).not.toBeNull();
  });

  it('trigger renders the currentShape glyph (filled-black → black-fill circle)', () => {
    render(<StationShapePicker disabled={false} currentShape="filled-black" onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#000');
  });

  it('disabled trigger still renders a glyph (so the button is not visually empty)', () => {
    render(<StationShapePicker disabled currentShape="filled-black" onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger.querySelector('circle, polygon')).not.toBeNull();
  });

  it('Escape closes the menu without firing onPick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StationShapePicker disabled={false} currentShape="filled-black" onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('outside click closes the menu without firing onPick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <div>
        <StationShapePicker disabled={false} currentShape="filled-black" onPick={onPick} />
        <button data-testid="outside">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('tooltip text differs by disabled state', () => {
    const { rerender } = render(
      <StationShapePicker disabled currentShape="filled-black" onPick={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'title',
      'Stop shape — select a stop first',
    );
    rerender(<StationShapePicker disabled={false} currentShape="filled-black" onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'title',
      'Stop shape',
    );
  });
});
