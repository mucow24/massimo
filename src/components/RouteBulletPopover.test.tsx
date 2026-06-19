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

  it('clamps size at MIN only in the transform (above the slider max is allowed)', () => {
    useDoc.getState().updateRouteBullet('b1', { size: 999 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(999);
    useDoc.getState().updateRouteBullet('b1', { size: -3 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(ROUTE_BULLET_SIZE_MIN);
  });
});
