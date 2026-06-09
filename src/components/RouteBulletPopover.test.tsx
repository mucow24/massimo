import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteBulletPopover } from './RouteBulletPopover';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC, ROUTE_BULLET_SIZE_MAX } from '../model/transforms';
import type { RouteBullet } from '../model/types';

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

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC, routeBullets: { b1: { ...BULLET } } });
  useDoc.temporal.getState().clear();
});

describe('<RouteBulletPopover /> size control', () => {
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

  it('clamps an out-of-range size in the transform', () => {
    useDoc.getState().updateRouteBullet('b1', { size: 999 });
    expect(useDoc.getState().routeBullets.b1.size).toBe(ROUTE_BULLET_SIZE_MAX);
  });
});
