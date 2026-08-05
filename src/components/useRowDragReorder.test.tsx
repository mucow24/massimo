import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRowDragReorder } from './useRowDragReorder';

const ROW = 40;

function Harness({ count, onCommit }: { count: number; onCommit: (f: number, t: number) => void }) {
  const { drag, handleProps } = useRowDragReorder({ count, rowHeight: ROW, onCommit });
  return (
    <div data-testid="list" data-drag={drag ? `${drag.from}->${drag.to}` : 'idle'}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} aria-label={`Reorder ${i}`} {...handleProps(i)} />
      ))}
    </div>
  );
}

const setup = (count = 4) => {
  const onCommit = vi.fn();
  render(<Harness count={count} onCommit={onCommit} />);
  const handle = (i: number) => screen.getByRole('button', { name: `Reorder ${i}` });
  return { onCommit, handle, list: () => screen.getByTestId('list') };
};

const down = (el: HTMLElement, clientY: number) =>
  fireEvent.pointerDown(el, { clientY, pointerId: 1, buttons: 1 });
const move = (el: HTMLElement, clientY: number, buttons = 1) =>
  fireEvent.pointerMove(el, { clientY, pointerId: 1, buttons });
const up = (el: HTMLElement, clientY: number) => fireEvent.pointerUp(el, { clientY, pointerId: 1 });

describe('useRowDragReorder', () => {
  // The house primary-button rule: only button 0 arms a drag. A right-button
  // press never trips pointerLost (buttons=2), so without the guard it would
  // drive a reorder under the context menu.
  it('a non-primary press never arms', () => {
    const { onCommit, handle, list } = setup();
    fireEvent.pointerDown(handle(0), { clientY: 100, pointerId: 1, button: 2, buttons: 2 });
    fireEvent.pointerMove(handle(0), { clientY: 100 + 2 * ROW, pointerId: 1, buttons: 2 });
    expect(list().dataset.drag).toBe('idle');
    fireEvent.pointerUp(handle(0), { clientY: 100 + 2 * ROW, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a sub-threshold press commits nothing and never previews', () => {
    const { onCommit, handle, list } = setup();
    down(handle(0), 100);
    move(handle(0), 103);
    expect(list().dataset.drag).toBe('idle');
    up(handle(0), 103);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('previews the landing row while dragging', () => {
    const { handle, list } = setup();
    down(handle(0), 100);
    move(handle(0), 100 + 2 * ROW);
    expect(list().dataset.drag).toBe('0->2');
  });

  it('commits once, on pointerup only', () => {
    const { onCommit, handle } = setup();
    down(handle(0), 100);
    move(handle(0), 100 + ROW);
    move(handle(0), 100 + 2 * ROW);
    expect(onCommit).not.toHaveBeenCalled();
    up(handle(0), 100 + 2 * ROW);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, 2);
  });

  it('a drag released where it started commits nothing', () => {
    const { onCommit, handle } = setup();
    down(handle(1), 100);
    move(handle(1), 100 + ROW);
    move(handle(1), 100);
    up(handle(1), 100);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clamps the landing row to the list', () => {
    const { onCommit, handle } = setup(3);
    down(handle(1), 100);
    move(handle(1), 100 + 10 * ROW);
    up(handle(1), 100 + 10 * ROW);
    expect(onCommit).toHaveBeenCalledWith(1, 2);
  });

  it('drags up as well as down', () => {
    const { onCommit, handle } = setup();
    down(handle(2), 200);
    move(handle(2), 200 - 2 * ROW);
    up(handle(2), 200 - 2 * ROW);
    expect(onCommit).toHaveBeenCalledWith(2, 0);
  });

  it('Escape mid-drag abandons the gesture without committing', () => {
    const { onCommit, handle, list } = setup();
    down(handle(0), 100);
    move(handle(0), 100 + 2 * ROW);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(list().dataset.drag).toBe('idle');
    up(handle(0), 100 + 2 * ROW);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a button-less move reads as a lost pointer and cancels', () => {
    const { onCommit, handle, list } = setup();
    down(handle(0), 100);
    move(handle(0), 100 + 2 * ROW);
    move(handle(0), 100 + 2 * ROW + 1, 0);
    expect(list().dataset.drag).toBe('idle');
    up(handle(0), 100 + 3 * ROW);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('pointercancel abandons the gesture', () => {
    const { onCommit, handle, list } = setup();
    down(handle(0), 100);
    move(handle(0), 100 + 2 * ROW);
    fireEvent.pointerCancel(handle(0));
    expect(list().dataset.drag).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
