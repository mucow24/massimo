import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerOrderRow } from './LayerOrderRow';

const handlers = () => ({
  onMoveToTop: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onMoveToBottom: vi.fn(),
});

describe('LayerOrderRow', () => {
  it('labels every button with the given noun and wires each to its own handler', async () => {
    const h = handlers();
    render(<LayerOrderRow noun="polygon" {...h} disabled={false} />);

    await userEvent.click(screen.getByLabelText('Move polygon to top'));
    await userEvent.click(screen.getByLabelText('Move polygon up'));
    await userEvent.click(screen.getByLabelText('Move polygon down'));
    await userEvent.click(screen.getByLabelText('Move polygon to bottom'));

    // Exactly once each: a handler wired to two buttons would count twice.
    expect(h.onMoveToTop).toHaveBeenCalledOnce();
    expect(h.onMoveUp).toHaveBeenCalledOnce();
    expect(h.onMoveDown).toHaveBeenCalledOnce();
    expect(h.onMoveToBottom).toHaveBeenCalledOnce();
  });

  // Left→right runs topmost action to bottommost, so the row reads as one
  // gradient rather than an arbitrary pairing.
  it('orders the buttons top → up → down → bottom', () => {
    render(<LayerOrderRow noun="image" {...handlers()} disabled={false} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move image to top',
      'Move image up',
      'Move image down',
      'Move image to bottom',
    ]);
  });

  it('disables every button and blocks clicks when locked', async () => {
    const h = handlers();
    render(<LayerOrderRow noun="image" {...h} disabled={true} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const b of buttons) {
      expect(b).toBeDisabled();
      await userEvent.click(b);
    }
    expect(h.onMoveToTop).not.toHaveBeenCalled();
    expect(h.onMoveUp).not.toHaveBeenCalled();
    expect(h.onMoveDown).not.toHaveBeenCalled();
    expect(h.onMoveToBottom).not.toHaveBeenCalled();
  });
});
