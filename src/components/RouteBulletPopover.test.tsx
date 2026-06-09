import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteBulletPopover } from './RouteBulletPopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
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

describe('RouteBulletPopover', () => {
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

  it('changes the size via the range slider', () => {
    renderPopover(bulletFixture());
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    expect(useDoc.getState().routeBullets['b1'].size).toBe(20);
  });

  it('nudges the size with the mouse wheel (clamped 6–48)', () => {
    renderPopover(bulletFixture({ size: 10 }));
    fireEvent.wheel(screen.getByRole('slider'), { deltaY: -1 }); // up → +1
    expect(useDoc.getState().routeBullets['b1'].size).toBe(11);
  });

  it('deletes the bullet and closes', () => {
    const { onClose } = renderPopover(bulletFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().routeBullets['b1']).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
