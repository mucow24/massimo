import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SvgImagePopover } from './SvgImagePopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeSvgImage } from '../test/fixtures';

const view = { vbX: 0, vbY: 0, vbW: 100, vbH: 100, size: { w: 100, h: 100 } };

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    svgImages: { i0: makeSvgImage({ id: 'i0' }), i1: makeSvgImage({ id: 'i1' }) },
    svgImageOrder: ['i0', 'i1'],
  });
});

const renderPopover = (id = 'i0', onClose = () => {}) =>
  render(
    <SvgImagePopover
      image={useDoc.getState().svgImages[id]}
      worldRect={{ x0: -50, y0: -30, x1: 50, y1: 30 }}
      view={view}
      onClose={onClose}
    />,
  );

describe('<SvgImagePopover />', () => {
  it('toggles the lock flag', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Lock image' }));
    expect(useDoc.getState().svgImages.i0.locked).toBe(true);
  });

  it('moves the image up/down in the paint order', () => {
    renderPopover('i0');
    fireEvent.click(screen.getByRole('button', { name: 'Move image up' }));
    expect(useDoc.getState().svgImageOrder).toEqual(['i1', 'i0']);
  });

  it('disables layer + delete (but not unlock) when locked', () => {
    useDoc.setState({
      ...useDoc.getState(),
      svgImages: { i0: makeSvgImage({ id: 'i0', locked: true }) },
      svgImageOrder: ['i0'],
    });
    renderPopover();
    expect(screen.getByRole('button', { name: 'Move image up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move image down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    const unlock = screen.getByRole('button', { name: 'Unlock image' });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(useDoc.getState().svgImages.i0.locked).toBe(false);
  });

  it('deletes the image and calls onClose', () => {
    const onClose = vi.fn();
    renderPopover('i0', onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().svgImages.i0).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
