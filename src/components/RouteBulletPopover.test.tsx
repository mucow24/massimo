import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBulletPopover, ROUTE_BULLET_SHAPE_LABEL } from './RouteBulletPopover';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
import {
  DEFAULT_DOC,
  ROUTE_BULLET_SHAPES,
  ROUTE_BULLET_SIZE_MIN,
  ROUTE_BULLET_SIZE_STEP,
} from '../model/transforms';
import { makeLine, makeStyle } from '../test/fixtures';
import { chooseOption, stepSlider } from '../test/interaction';
import type { RouteBullet } from '../model/types';

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
    render(<RouteBulletPopover bullet={bullet} hostW={800} onClose={onClose} />);
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
    fireEvent.click(screen.getByLabelText('Square'));
    expect(useDoc.getState().routeBullets['b1'].shape).toBe('square');
  });

  // The popover and the Styles panel's route-bullet editor are two separate
  // renders of ONE ladder. Offering a different set from either would leave a
  // shape reachable in one surface and not the other, so both are checked
  // against the model's ladder rather than against a list spelled here.
  it('offers exactly the model ladder, in its order', () => {
    renderPopover(bulletFixture());
    const chips = screen
      .getAllByRole('radio')
      .map((el) => el.getAttribute('aria-label'))
      .filter(
        (l): l is string => l !== null && Object.values(ROUTE_BULLET_SHAPE_LABEL).includes(l),
      );
    expect(chips).toEqual(ROUTE_BULLET_SHAPES.map((s) => ROUTE_BULLET_SHAPE_LABEL[s]));
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
    expect(screen.getByLabelText('Square')).toBeDisabled();
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
      return <RouteBulletPopover bullet={bullet} hostW={800} onClose={() => {}} />;
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
    render(<RouteBulletPopover bullet={BULLET} hostW={800} onClose={() => {}} />);
    fireEvent.wheel(screen.getByRole('spinbutton'), { deltaY: -1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size + ROUTE_BULLET_SIZE_STEP);
  });

  it('a wheel notch over the slider steps the size once (row-level handler)', () => {
    render(<RouteBulletPopover bullet={BULLET} hostW={800} onClose={() => {}} />);
    fireEvent.wheel(screen.getByRole('slider'), { deltaY: 1 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(BULLET.size - ROUTE_BULLET_SIZE_STEP);
  });

  it('wheel over a locked bullet’s size row leaves the size unchanged', () => {
    // The row-level wheel handler must respect the lock — both inputs are
    // disabled, so a wheel notch anywhere in the row must not edit the bullet.
    const locked = { ...BULLET, locked: true };
    useDoc.setState({ ...DEFAULT_DOC, routeBullets: { b1: locked } });
    render(<RouteBulletPopover bullet={locked} hostW={800} onClose={() => {}} />);
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
        <RouteBulletPopover bullet={bullet} hostW={800} onClose={vi.fn()} />
      </div>,
    );
    fireEvent.contextMenu(container.querySelector('.bullet-popover .body')!);
    expect(onContextMenu).not.toHaveBeenCalled();
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
    return bullet ? <RouteBulletPopover bullet={bullet} hostW={800} onClose={() => {}} /> : null;
  }

  it('applies a preset from the Style row; a covered edit keeps the style (override)', async () => {
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
    // A covered edit (shape) becomes a per-field override — the tag stays.
    fireEvent.click(screen.getByLabelText('Square'));
    expect(useDoc.getState().routeBullets['b1'].styleId).toBe('y1');
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Big');
  });
});
