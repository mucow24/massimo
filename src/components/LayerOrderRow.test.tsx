import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerOrderRow } from './LayerOrderRow';

describe('LayerOrderRow', () => {
  it('labels both buttons with the given noun and wires the handlers', async () => {
    const onMoveDown = vi.fn();
    const onMoveUp = vi.fn();
    render(
      <LayerOrderRow noun="polygon" onMoveDown={onMoveDown} onMoveUp={onMoveUp} disabled={false} />,
    );

    await userEvent.click(screen.getByLabelText('Move polygon down'));
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(onMoveUp).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Move polygon up'));
    expect(onMoveUp).toHaveBeenCalledOnce();
  });

  it('disables both buttons and blocks clicks when locked', async () => {
    const onMoveDown = vi.fn();
    const onMoveUp = vi.fn();
    render(
      <LayerOrderRow noun="image" onMoveDown={onMoveDown} onMoveUp={onMoveUp} disabled={true} />,
    );

    const down = screen.getByLabelText('Move image down');
    const up = screen.getByLabelText('Move image up');
    expect(down).toBeDisabled();
    expect(up).toBeDisabled();

    await userEvent.click(down);
    await userEvent.click(up);
    expect(onMoveDown).not.toHaveBeenCalled();
    expect(onMoveUp).not.toHaveBeenCalled();
  });
});
