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

  it('dragging the header moves the popover by the pointer delta', () => {
    const { container } = renderPopover();
    const popover = container.querySelector('.polygon-popover') as HTMLElement;
    const header = container.querySelector('.polygon-popover .header') as HTMLElement;
    // Centroid (0,0) projects to (0,0); base offset is +14/+14.
    expect(popover.style.left).toBe('14px');
    expect(popover.style.top).toBe('14px');
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(header, { clientX: 130, clientY: 120 });
    expect(popover.style.left).toBe('44px'); // 14 + 30
    expect(popover.style.top).toBe('34px'); // 14 + 20
  });
});
