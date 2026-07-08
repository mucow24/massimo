import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePersistedTextareaHeight } from './usePersistedTextareaHeight';

function Harness({ height, onCommit }: { height?: number; onCommit: (h: number) => void }) {
  const { attach, onPointerUp } = usePersistedTextareaHeight(height, onCommit);
  return <textarea data-testid="ta" ref={attach} onPointerUp={onPointerUp} />;
}

const ta = () => screen.getByTestId('ta') as HTMLTextAreaElement;

describe('usePersistedTextareaHeight', () => {
  it('applies the stored height to the textarea on mount', () => {
    render(<Harness height={150} onCommit={() => {}} />);
    expect(ta().style.height).toBe('150px');
  });

  it('leaves the height unset (auto-sized) when no height is stored', () => {
    render(<Harness onCommit={() => {}} />);
    expect(ta().style.height).toBe('');
  });

  it('commits the new height on pointer-up after the grip is dragged', () => {
    const onCommit = vi.fn();
    render(<Harness height={150} onCommit={onCommit} />);
    // The browser writes the dragged height to the element's inline style;
    // simulate that, then release the pointer.
    ta().style.height = '210px';
    fireEvent.pointerUp(ta());
    expect(onCommit).toHaveBeenCalledWith(210);
  });

  it('rounds a fractional dragged height before committing', () => {
    const onCommit = vi.fn();
    render(<Harness height={150} onCommit={onCommit} />);
    ta().style.height = '210.6px';
    fireEvent.pointerUp(ta());
    expect(onCommit).toHaveBeenCalledWith(211);
  });

  it('does not commit on pointer-up when the height is unchanged (a plain click)', () => {
    const onCommit = vi.fn();
    render(<Harness height={150} onCommit={onCommit} />);
    fireEvent.pointerUp(ta()); // style.height is still the applied 150px
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits the first drag from an auto-sized (no stored height) box', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    ta().style.height = '120px';
    fireEvent.pointerUp(ta());
    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it('re-applies the height when switching to a label with a different stored height', () => {
    const { rerender } = render(<Harness height={150} onCommit={() => {}} />);
    expect(ta().style.height).toBe('150px');
    rerender(<Harness height={200} onCommit={() => {}} />);
    expect(ta().style.height).toBe('200px');
  });
});
