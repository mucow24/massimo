import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorField } from './ColorField';
import { useDoc } from '../state/store';

beforeEach(() => {
  localStorage.clear();
  useDoc.temporal.getState().clear();
});

describe('<ColorField />', () => {
  it('opens the picker popover on swatch click and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByLabelText('Test color'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" disabled />);
    await user.click(screen.getByLabelText('Test color'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('normalizes an opaque hex value to 6 digits before calling onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#112233" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '112233ff');
    // The trailing opaque ff is stripped — stored values stay 6-digit unless a
    // real alpha is chosen (keeps palette-swatch matching working).
    expect(onChange).toHaveBeenLastCalledWith('#112233');
  });

  it('keeps a translucent alpha when the hex carries one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#112233" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '11223380');
    expect(onChange).toHaveBeenLastCalledWith('#11223380');
  });

  it('collapses the whole edit session into one undo group', async () => {
    // Opening the picker pauses history; closing commits exactly one entry
    // regardless of how many onChange ticks the drag produced. A per-tick doc
    // write (setDocName) stands in for the real color write.
    const user = userEvent.setup();
    let ticks = 0;
    const startDepth = useDoc.temporal.getState().pastStates.length;
    render(
      <ColorField
        value="#112233"
        onChange={() => useDoc.getState().setDocName(`tick-${++ticks}`)}
        ariaLabel="Test color"
      />,
    );
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, 'aabbcc');
    expect(ticks).toBeGreaterThan(0); // the picker actually emitted
    // Still open → history is paused → no new past entries yet.
    expect(useDoc.temporal.getState().pastStates.length).toBe(startDepth);
    await user.keyboard('{Escape}');
    // Closing commits ONE grouped entry for the whole session.
    expect(useDoc.temporal.getState().pastStates.length).toBe(startDepth + 1);
  });
});
