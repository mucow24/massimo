import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBulletPopover } from './RouteBulletPopover';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC, ROUTE_BULLET_SIZE_MIN, ROUTE_BULLET_SIZE_STEP } from '../model/transforms';
import { makeLine, makeStyle } from '../test/fixtures';
import { chooseOption, stepSlider } from '../test/interaction';
import type { RouteBullet } from '../model/types';

const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

// Degenerate point rect for the spawn hint — placement details live in
// screenAnchor.test.ts; here the point keeps positions easy to reason about.
const rectAt = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

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
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={onClose}
      />,
    );
    return { onClose };
  }

  it('changes the bound line via the dropdown', async () => {
    renderPopover(bulletFixture());
    await chooseOption(userEvent.setup(), 'Line', 'B');
    expect(useDoc.getState().routeBullets['b1'].lineId).toBe('L2');
  });

  it('unbinds the line when "none" is chosen', async () => {
    renderPopover(bulletFixture());
    await chooseOption(userEvent.setup(), 'Line', '— none —');
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
    expect(screen.getByRole('combobox', { name: 'Line' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Style' })).toBeDisabled();
    expect(screen.getByLabelText('square')).toBeDisabled();
    // The Radix slider thumb carries data-disabled (no native disabled attr).
    expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
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
    // Successive arrow-key steps need the popover re-rendered with the fresh
    // store bullet between steps (the Radix slider is controlled), so mount it
    // live rather than passing the static BULLET snapshot.
    function LivePopover() {
      const bullet = useDoc((s) => s.routeBullets['b1']);
      return (
        <RouteBulletPopover
          bullet={bullet}
          worldRect={rectAt(10, 10)}
          view={VIEW}
          onClose={() => {}}
        />
      );
    }
    render(<LivePopover />);
    const slider = screen.getByRole('slider');
    const before = historyDepth();
    // A drag: focus (mousedown focuses the thumb in a browser), several
    // arrow-key steps, then blur. useFieldHistory opens one group on focus and
    // commits exactly one entry on blur — the NumericFieldRow wiring shared
    // with the Options and polygon popovers.
    stepSlider(slider, 3);
    fireEvent.blur(slider);
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size + 3 * ROUTE_BULLET_SIZE_STEP);
    expect(historyDepth() - before).toBe(1);
  });

  it('one wheel notch over the spinbutton steps the size exactly once', () => {
    // Regression: onWheel was wired on BOTH the row and the spinbutton, so a
    // wheel event over the spinbutton ran the handler twice (once directly,
    // once via bubbling to the row) — every notch stepped the size by two.
    render(
      <RouteBulletPopover
        bullet={BULLET}
        worldRect={rectAt(10, 10)}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    fireEvent.wheel(screen.getByRole('spinbutton'), { deltaY: -1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size + ROUTE_BULLET_SIZE_STEP);
  });

  it('a wheel notch over the slider steps the size once (row-level handler)', () => {
    render(
      <RouteBulletPopover
        bullet={BULLET}
        worldRect={rectAt(10, 10)}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    fireEvent.wheel(screen.getByRole('slider'), { deltaY: 1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size - ROUTE_BULLET_SIZE_STEP);
  });

  it('wheel over a locked bullet’s size row leaves the size unchanged', () => {
    // The row-level wheel handler must respect the lock — both inputs are
    // disabled, so a wheel notch anywhere in the row must not edit the bullet.
    const locked = { ...BULLET, locked: true };
    useDoc.setState({ ...DEFAULT_DOC, routeBullets: { b1: locked } });
    render(
      <RouteBulletPopover
        bullet={locked}
        worldRect={rectAt(10, 10)}
        view={VIEW}
        onClose={() => {}}
      />,
    );
    fireEvent.wheel(screen.getByRole('slider'), { deltaY: -1 });
    fireEvent.wheel(screen.getByRole('spinbutton'), { deltaY: -1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size);
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
          worldRect={rectAt(0, 0)}
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
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.bullet-popover') as HTMLElement;
    const header = container.querySelector('.bullet-popover .header') as HTMLElement;
    expect(parseFloat(popover.style.left)).toBeCloseTo(14, 9); // point + 14 gap diagonal
    expect(parseFloat(popover.style.top)).toBeCloseTo(14, 9);
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(header, { clientX: 130, clientY: 120 });
    expect(parseFloat(popover.style.left)).toBeCloseTo(44, 9); // 14 + 30
    expect(parseFloat(popover.style.top)).toBeCloseTo(34, 9); // 14 + 20
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
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.bullet-popover') as HTMLElement;
    expect(parseFloat(popover.style.left)).toBeCloseTo(14, 9);
    rerender(
      <RouteBulletPopover
        bullet={bullet}
        worldRect={rectAt(100, 50)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(parseFloat(popover.style.left)).toBeCloseTo(14, 9);
    expect(parseFloat(popover.style.top)).toBeCloseTo(14, 9);
  });
});

describe('RouteBulletPopover — style presets', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  });

  // The real mount (ItemPopovers) passes the live store bullet; mirror that
  // so the Style row re-derives when an action writes the tag.
  function LivePopover() {
    const bullet = useDoc((s) => s.routeBullets['b1']);
    return bullet ? (
      <RouteBulletPopover
        bullet={bullet}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />
    ) : null;
  }

  it('applies a preset from the Style row, then flips to Custom on a covered edit', async () => {
    seed(bulletFixture());
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        y1: makeStyle('routeBullet', 'y1', { name: 'Big', props: { shape: 'diamond', size: 20 } }),
      },
    });
    render(<LivePopover />);
    await chooseOption(userEvent.setup(), 'Style', 'Big');
    expect(useDoc.getState().routeBullets['b1']).toMatchObject({
      shape: 'diamond',
      size: 20,
      styleId: 'y1',
    });
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Big');
    // A covered edit (shape) detaches; the Line select stays identity-only.
    fireEvent.click(screen.getByLabelText('square'));
    expect(useDoc.getState().routeBullets['b1'].styleId).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Custom');
  });
});
