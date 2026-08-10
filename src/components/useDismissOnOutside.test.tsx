import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDismissOnOutside } from './useDismissOnOutside';

// A minimal stand-in for the affordances that use this: something transient
// that owns the window while it is up, plus an unrelated button outside it.
// `onDismiss` records the callback so a test can tell "stood down" from
// "re-rendered".
function Harness({
  onDismiss,
  onOutsideClick,
}: {
  onDismiss: () => void;
  onOutsideClick: () => void;
}) {
  const [open, setOpen] = useState(true);
  useDismissOnOutside(
    open,
    (t) => !!(t as HTMLElement | null)?.closest?.('[data-inside]'),
    () => {
      setOpen(false);
      onDismiss();
    },
  );
  return (
    <div>
      {open && (
        <div data-inside="1">
          <button type="button">inside</button>
        </div>
      )}
      <button type="button" onClick={onOutsideClick}>
        outside
      </button>
    </div>
  );
}

describe('useDismissOnOutside', () => {
  it('stands down on a press outside, and lets that press do its own job', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onOutsideClick = vi.fn();
    render(<Harness onDismiss={onDismiss} onOutsideClick={onOutsideClick} />);

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // NOT consumed: clicking straight from an open affordance onto a control
    // does both things.
    expect(onOutsideClick).toHaveBeenCalledTimes(1);
  });

  it('leaves a press inside alone', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} onOutsideClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'inside' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('stands down on Escape and CONSUMES the key', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    // An enclosing listener stands in for the dialog that must not also read
    // the keypress as "close me".
    const enclosing = vi.fn();
    window.addEventListener('keydown', enclosing);
    try {
      render(<Harness onDismiss={onDismiss} onOutsideClick={vi.fn()} />);
      await user.keyboard('{Escape}');
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(enclosing).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', enclosing);
    }
  });

  it('ignores everything once inactive', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} onOutsideClick={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // The listeners came off with `active`, so a second press finds nothing.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
