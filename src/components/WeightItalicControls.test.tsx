import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeightSelect } from './WeightItalicControls';

describe('WeightSelect', () => {
  it('opens on click and selects a weight by clicking its option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WeightSelect value={400} italic={false} onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Weight' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(700);
  });

  it('previews each option in its own weight and the current italic', async () => {
    const user = userEvent.setup();
    render(<WeightSelect value={400} italic onChange={() => {}} />);
    await user.click(screen.getByRole('combobox', { name: 'Weight' }));
    const bold = await screen.findByRole('option', { name: 'Bold' });
    expect(bold).toHaveStyle({ fontWeight: 700, fontStyle: 'italic' });
  });

  it('supports keyboard selection from the closed trigger', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WeightSelect value={400} italic={false} onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Weight' });
    trigger.focus();
    await user.keyboard('{Enter}'); // open; highlight rests on the current value (Roman)
    await user.keyboard('{ArrowDown}{Enter}'); // next weight down: Medium (500)
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it('is disabled as a whole when disabled', () => {
    render(<WeightSelect value={400} italic={false} disabled onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Weight' })).toBeDisabled();
  });
});
