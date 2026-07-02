import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteBulletPopover } from './RouteBulletPopover';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC, ROUTE_BULLET_SIZE_MIN } from '../model/transforms';
import { makeLine } from '../test/fixtures';
import type { RouteBullet } from '../model/types';

const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

function seed(bullet: RouteBullet) {
  useDoc.setState({
    ...useDoc.getState(),
    lines: {
      L1: makeLine({ id: 'L1', service: 'A', stations: [] }),
      L2: makeLine({ id: 'L2', service: 'B', stations: [] }),
    },
    lineOrder: ['L1', 'L2'],
    routeBullets: { [bullet.id]: bullet },
  });
}

const bulletFixture = (over: Partial<RouteBullet> = {}): RouteBullet => ({
  id: 'b1',
  x: 0,
  y: 0,
  rotation: 0,
  lineId: 'L1',
  shape: 'circle',
  size: 10,
  ...over,
});

describe('RouteBulletPopover — line / shape / delete', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  });

  function renderPopover(bullet: RouteBullet, onClose = vi.fn()) {
    seed(bullet);
    render(
      <RouteBulletPopover
        bullet={bullet}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={onClose}
      />,
    );
    return { onClose };
  }

  it('changes the bound line via the dropdown', () => {
    renderPopover(bulletFixture());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'L2' } });
    expect(useDoc.getState().routeBullets['b1'].lineId).toBe('L2');
  });

  it('unbinds the line when "none" is chosen', () => {
    renderPopover(bulletFixture());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(useDoc.getState().routeBullets['b1'].lineId).toBeNull();
  });

  it('changes the shape via the shape buttons', () => {
    renderPopover(bulletFixture());
    fireEvent.click(screen.getByLabelText('square'));
    expect(useDoc.getState().routeBullets['b1'].shape).toBe('square');
  });

  it('deletes the bullet and closes', () => {
    const { onClose } = renderPopover(bulletFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().routeBullets['b1']).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the lock toggle flips locked and the label updates', () => {
    renderPopover(bulletFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Lock route bullet' }));
    expect(useDoc.getState().routeBullets['b1'].locked).toBe(true);
  });

  it('when locked, editing controls are disabled but the lock toggle stays active', () => {
    renderPopover(bulletFixture({ locked: true }));
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByLabelText('square')).toBeDisabled();
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    // The unlock control remains usable.
    const unlock = screen.getByRole('button', { name: 'Unlock route bullet' });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(useDoc.getState().routeBullets['b1'].locked).toBe(false);
  });
});

// Size control was unified onto the useNumericField / useFieldHistory idiom in
// the arch cleanup; these tests come from that change.
const VIEW = { vbX: 0, vbY: 0, vbW: 100, vbH: 100, size: { w: 100, h: 100 } };

const BULLET: RouteBullet = {
  id: 'b1',
  x: 10,
  y: 10,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 14,
};

describe('<RouteBulletPopover /> size control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC, routeBullets: { b1: { ...BULLET } } });
    useDoc.temporal.getState().clear();
  });

  it('groups a size-slider drag into a single undo entry', () => {
    render(
      <RouteBulletPopover
        bullet={BULLET}
        world={{ x: 10, y: 10 }}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    const slider = screen.getByRole('slider');
    const before = historyDepth();
    // A drag: press, several value changes, release. useFieldHistory opens one
    // group on mousedown and commits exactly one entry on mouseup.
    fireEvent.mouseDown(slider);
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.mouseUp(slider);
    expect(useDoc.getState().routeBullets.b1.size).toBe(30);
    expect(historyDepth() - before).toBe(1);
  });

  it('one wheel notch over the spinbutton steps the size exactly once', () => {
    // Regression: onWheel was wired on BOTH the row and the spinbutton, so a
    // wheel event over the spinbutton ran the handler twice (once directly,
    // once via bubbling to the row) — every notch stepped the size by two.
    render(
      <RouteBulletPopover
        bullet={BULLET}
        world={{ x: 10, y: 10 }}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    fireEvent.wheel(screen.getByRole('spinbutton'), { deltaY: -1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size + 1);
  });

  it('a wheel notch over the slider steps the size once (row-level handler)', () => {
    render(
      <RouteBulletPopover
        bullet={BULLET}
        world={{ x: 10, y: 10 }}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    fireEvent.wheel(screen.getByRole('slider'), { deltaY: 1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size - 1);
  });

  it('clamps size at MIN only in the transform (above the slider max is allowed)', () => {
    useDoc.getState().updateRouteBullet('b1', { size: 999 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(999);
    useDoc.getState().updateRouteBullet('b1', { size: -3 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(ROUTE_BULLET_SIZE_MIN);
  });
});

describe('<RouteBulletPopover /> canvas event swallowing', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  });

  // The item popovers float over the canvas, so every canvas-bound pointer
  // gesture fired inside them must be swallowed — a leaked right-click would
  // context-menu (rotate) whatever sits under the popover.
  it('does not let a right-click inside the popover reach the canvas', () => {
    const bullet = bulletFixture();
    seed(bullet);
    const onContextMenu = vi.fn();
    const { container } = render(
      <div onContextMenu={onContextMenu}>
        <RouteBulletPopover
          bullet={bullet}
          world={{ x: 0, y: 0 }}
          view={identityView}
          onClose={vi.fn()}
        />
      </div>,
    );
    fireEvent.contextMenu(container.querySelector('.bullet-popover .body')!);
    expect(onContextMenu).not.toHaveBeenCalled();
  });
});

describe('<RouteBulletPopover /> header drag', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC, routeBullets: { b1: bulletFixture() } });
    useDoc.temporal.getState().clear();
  });

  // The bullet popover shares useDraggablePopover with the other three item
  // popovers — its header strip must actually drag, not just look like the
  // others' drag handles.
  it('dragging the header moves the popover by the pointer delta', () => {
    const { container } = render(
      <RouteBulletPopover
        bullet={useDoc.getState().routeBullets['b1']}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.bullet-popover') as HTMLElement;
    const header = container.querySelector('.bullet-popover .header') as HTMLElement;
    expect(popover.style.left).toBe('14px'); // 0 + 14 base offset
    expect(popover.style.top).toBe('14px');
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(header, { clientX: 130, clientY: 120 });
    expect(popover.style.left).toBe('44px'); // 14 + 30
    expect(popover.style.top).toBe('34px'); // 14 + 20
  });

  // Deliberate behavior change from adopting useDraggablePopover: the anchor
  // freezes at selection time (like the other item popovers), so moving the
  // bullet itself (canvas drag, arrow nudge, undo) no longer drags the popover
  // around — only pan/zoom and the header drag move it.
  it('freezes the anchor: a moved bullet does not re-anchor the popover', () => {
    const bullet = useDoc.getState().routeBullets['b1'];
    const { container, rerender } = render(
      <RouteBulletPopover
        bullet={bullet}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.bullet-popover') as HTMLElement;
    expect(popover.style.left).toBe('14px');
    rerender(
      <RouteBulletPopover
        bullet={bullet}
        world={{ x: 100, y: 50 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(popover.style.left).toBe('14px');
    expect(popover.style.top).toBe('14px');
  });
});
