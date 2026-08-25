import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useInlineRename } from './useInlineRename';

/**
 * The hook's own contract, tested once here rather than five times over.
 *
 * Every inline rename in the app runs on it — the map name, a style's name in
 * the Styles panel, "Save style…" in the style-preset row, the palette editor's
 * title, and both name fields in a palette color row — and the library dialog
 * hand-rolls a copy of the same BEHAVIOUR because its commit is async
 * (`RenameField` in MapLibraryDialog.tsx). Each of those has tests for what it
 * does with a committed draft; none of them pins what "committed" means. So a
 * change here — one that dropped the select-on-focus, or let Enter commit and
 * then let the blur it triggers commit a second time — would break the same
 * gesture on six surfaces while every one of their suites stayed green.
 */
function Harness({
  onCommit,
  initial = 'Canal St',
}: {
  onCommit: (d: string) => void;
  initial?: string;
}) {
  const { editing, start, inputProps } = useInlineRename(onCommit);
  return editing ? (
    <input aria-label="Name" {...inputProps} />
  ) : (
    <button type="button" onClick={() => start(initial)}>
      {initial}
    </button>
  );
}

const enterEdit = async (user: ReturnType<typeof userEvent.setup>, initial = 'Canal St') => {
  await user.click(screen.getByRole('button', { name: initial }));
  return screen.getByRole('textbox', { name: 'Name' });
};

describe('useInlineRename', () => {
  it('opens on the current name, with the whole of it selected', async () => {
    const user = userEvent.setup();
    render(<Harness onCommit={vi.fn()} />);
    const input = (await enterEdit(user)) as HTMLInputElement;
    expect(input).toHaveValue('Canal St');
    // Select-on-focus is what makes the first keystroke REPLACE rather than
    // append — the behaviour #547 brought the library dialog into line with.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Canal St'.length);
  });

  it('replaces the name on the first keystroke, then commits it on Enter', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('Canal Street{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Canal Street');
  });

  // Enter commits by blurring, and the blur commits. Nothing stops that being
  // read as two commits — a rename is one undo entry, and a doubled one on a
  // palette upsert would mint the same color twice.
  it('commits exactly once on Enter, though Enter reaches commit through a blur', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('Broad{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits on a plain blur — clicking away is a commit, not an abandon', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('Fulton');
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Fulton');
  });

  it('Escape reverts without a commit — and closes the field', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('Throwaway{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Canal St' })).toBeInTheDocument();
  });

  // The cancel flag is a ref, so it outlives the render that set it. Re-entry
  // has to clear it, or the field opens permanently unable to commit.
  it('a cancelled edit does not poison the next one', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('Throwaway{Escape}');
    await enterEdit(user);
    await user.keyboard('Wall St{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Wall St');
  });

  // Each caller trims / validates / falls back as its own model requires (the
  // map name defaults when empty; a style name refuses "Custom"). The hook
  // deciding for them would take that away.
  it('hands over the RAW draft — no trim, no empty-string rule of its own', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.keyboard('  Astor Pl  {Enter}');
    expect(onCommit).toHaveBeenCalledWith('  Astor Pl  ');
  });

  it('commits an emptied field rather than swallowing it', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    await enterEdit(user);
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('');
  });
});
