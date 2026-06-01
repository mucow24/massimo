import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PolygonPopover } from './PolygonPopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon } from '../test/fixtures';

const view = { vbX: 0, vbY: 0, vbW: 100, vbH: 100, size: { w: 100, h: 100 } };

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    polygons: { p0: makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566', strokeWidth: 2 }) },
  });
});

function renderPopover(onClose = () => {}) {
  return render(
    <PolygonPopover polygon={useDoc.getState().polygons['p0']} view={view} onClose={onClose} />,
  );
}

describe('<PolygonPopover />', () => {
  it('renders fill + stroke color pickers, a 0–10 stroke-width control, and Delete', () => {
    const { container } = renderPopover();
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '10');
    expect(screen.getByRole('spinbutton', { name: 'Stroke width' })).toBeInTheDocument();
    // Two color pickers (fill + stroke) reflecting the polygon's colors.
    const colorInputs = Array.from(
      container.querySelectorAll('input[type="color"]'),
    ) as HTMLInputElement[];
    const values = colorInputs.map((i) => i.value);
    expect(values).toContain('#112233');
    expect(values).toContain('#445566');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('editing the stroke-width slider writes through to the store', () => {
    renderPopover();
    fireEvent.change(screen.getByRole('slider', { name: 'Stroke width' }), {
      target: { value: '7' },
    });
    expect(useDoc.getState().polygons['p0'].strokeWidth).toBe(7);
  });

  it('Delete removes the polygon and calls onClose', () => {
    const onClose = vi.fn();
    renderPopover(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().polygons['p0']).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});
