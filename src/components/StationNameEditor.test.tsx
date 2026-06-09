import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Spy on doc-level undo/redo while keeping the real history internals that
// store.beginHistoryGroup depends on (pushHistory/pause/resume).
vi.mock('../state/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/history')>();
  return { ...actual, undo: vi.fn(), redo: vi.fn() };
});

import { StationNameEditor } from './StationNameEditor';
import { undo, redo } from '../state/history';

function renderEditor(over: Partial<Parameters<typeof StationNameEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <svg>
      <StationNameEditor
        x={0}
        y={0}
        width={100}
        minHeight={20}
        transform=""
        fontSize={12}
        fontWeight={400}
        italic={false}
        textAlign="left"
        value="Hi"
        onChange={onChange}
        onCommit={onCommit}
        {...over}
      />
    </svg>,
  );
  return { onChange, onCommit, textarea: screen.getByRole('textbox') as HTMLTextAreaElement };
}

beforeEach(() => {
  vi.mocked(undo).mockClear();
  vi.mocked(redo).mockClear();
});

describe('StationNameEditor', () => {
  it('propagates edits via onChange', () => {
    const { onChange, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenCalledWith('Hello');
  });

  it('commits on Enter', () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does NOT commit on Shift+Enter (newline)', () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on Escape', () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits on blur', () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.blur(textarea);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('runs doc-level undo and closes on Ctrl+Z', () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('runs doc-level redo on Ctrl+Shift+Z', () => {
    const { textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('runs doc-level redo on Ctrl+Y', () => {
    const { textarea } = renderEditor();
    fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });
});
