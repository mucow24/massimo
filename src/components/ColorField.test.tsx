import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
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

  // The picker is PORTALED out of the swatch's subtree, so "inside" can't be a
  // single containment test — it has to name the popover as well. Get that
  // wrong and the first press on a swatch/slider shuts the picker.
  it('closes on a press outside, but not on one inside the portaled picker', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(screen.getByLabelText('Test color'));
    const picker = screen.getByRole('dialog');

    await user.click(screen.getByLabelText('Test color hex value'));
    expect(screen.getByRole('dialog')).toBe(picker);

    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
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

  it('applies exactly the typed hex when typed char-by-char into a live-bound field', async () => {
    // Regression: react-colorful's HexColorInput re-derives its text from the
    // `color` prop on every change with no focus guard, so a normalizing,
    // live-bound parent reset the field mid-type and a 3-digit short form ('505')
    // expanded to '#550055' and hijacked it. Typing '505050' must land on
    // exactly '#505050'.
    const user = userEvent.setup();
    function Harness() {
      const [c, setC] = useState('#000000');
      return <ColorField value={c} onChange={setC} ariaLabel="Test color" />;
    }
    render(<Harness />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '505050');
    expect(hex).toHaveValue('#505050');
  });

  it('accepts a 3-digit short form on blur (expands to 6-digit)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, 'abc');
    // Short form does NOT apply live (would hijack a longer entry)...
    expect(onChange).not.toHaveBeenCalledWith('#aabbcc');
    // ...but commits on blur.
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
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

  it('addNew renders a "+" add affordance instead of a color chip, and still opens the picker', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="New color" addNew />);
    const btn = screen.getByLabelText('New color');
    expect(btn.classList.contains('add-new')).toBe(true);
    // The "+" glyph, not the value-mirroring chip.
    expect(btn.querySelector('.color-field-add')).not.toBeNull();
    expect(btn.querySelector('.color-field-chip')).toBeNull();
    // The picker still opens (seeded at value).
    await user.click(btn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
