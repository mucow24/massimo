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
    polygonOrder: ['p0'],
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

  it('renders dark-mode pickers initialized to the light colors', () => {
    renderPopover();
    // Uncustomized fixture → the dark colors equal the light colors.
    expect(screen.getByLabelText('Dark mode color')).toHaveValue('#112233');
    expect(screen.getByLabelText('Dark mode stroke color')).toHaveValue('#445566');
  });

  it('the dark-mode pickers reflect explicit dark colors when set', () => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({
          id: 'p0',
          fill: '#112233',
          stroke: '#445566',
          darkFill: '#778899',
          darkStroke: '#99aabb',
        }),
      },
      polygonOrder: ['p0'],
    });
    renderPopover();
    expect(screen.getByLabelText('Dark mode color')).toHaveValue('#778899');
    expect(screen.getByLabelText('Dark mode stroke color')).toHaveValue('#99aabb');
  });

  it('editing the dark-mode fill writes darkFill, leaving the light fill alone', () => {
    renderPopover();
    fireEvent.change(screen.getByLabelText('Dark mode color'), { target: { value: '#0a0a0a' } });
    expect(useDoc.getState().polygons['p0'].darkFill).toBe('#0a0a0a');
    expect(useDoc.getState().polygons['p0'].fill).toBe('#112233');
  });

  it('editing the dark-mode stroke writes darkStroke, leaving the light stroke alone', () => {
    renderPopover();
    fireEvent.change(screen.getByLabelText('Dark mode stroke color'), {
      target: { value: '#0b0b0b' },
    });
    expect(useDoc.getState().polygons['p0'].darkStroke).toBe('#0b0b0b');
    expect(useDoc.getState().polygons['p0'].stroke).toBe('#445566');
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

  it('re-freezes the centroid when a different polygon is selected', () => {
    // MapCanvas renders one <PolygonPopover> with no per-polygon key, so
    // selecting a different polygon reuses this instance. The frozen centroid
    // must re-freeze to the new polygon — otherwise a far-away polygon's
    // controls anchor at the previously selected polygon's position.
    const left = makePolygon({ id: 'p0' }); // centroid (0,0)
    const { container, rerender } = render(
      <PolygonPopover polygon={left} view={view} onClose={() => {}} />,
    );
    const popover = container.querySelector('.polygon-popover') as HTMLElement;
    expect(popover.style.left).toBe('14px'); // 0 + 14 base offset
    expect(popover.style.top).toBe('14px');

    const right = makePolygon({
      id: 'p1',
      vertices: [
        { x: 60, y: 40 },
        { x: 80, y: 40 },
        { x: 80, y: 60 },
        { x: 60, y: 60 },
      ],
    }); // centroid (70,50)
    rerender(<PolygonPopover polygon={right} view={view} onClose={() => {}} />);
    expect(popover.style.left).toBe('84px'); // 70 + 14
    expect(popover.style.top).toBe('64px'); // 50 + 14
  });

  it('the fill-opacity slider (0–100) writes through to the store', () => {
    renderPopover();
    const slider = screen.getByRole('slider', { name: 'Fill opacity' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(useDoc.getState().polygons['p0'].fillOpacity).toBe(40);
  });

  it('the curve-radius slider (0–50) writes through to the store', () => {
    renderPopover();
    const slider = screen.getByRole('slider', { name: 'Curve radius' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '50');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(useDoc.getState().polygons['p0'].curveRadius).toBe(20);
  });

  it('layer up/down buttons reorder the polygon among its peers', () => {
    // Two polygons, p0 at the bottom of the order.
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0' }), p1: makePolygon({ id: 'p1' }) },
      polygonOrder: ['p0', 'p1'],
    });
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Move polygon up' }));
    expect(useDoc.getState().polygonOrder).toEqual(['p1', 'p0']); // p0 now on top
    fireEvent.click(screen.getByRole('button', { name: 'Move polygon down' }));
    expect(useDoc.getState().polygonOrder).toEqual(['p0', 'p1']);
  });

  it('the lock toggle flips locked and the label updates', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Lock polygon' }));
    expect(useDoc.getState().polygons['p0'].locked).toBe(true);
  });

  it('when locked, editing controls are disabled but the lock toggle stays active', () => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
      polygonOrder: ['p0'],
    });
    renderPopover();
    expect(screen.getByRole('slider', { name: 'Fill opacity' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Curve radius' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move polygon up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    // All four color pickers (light + dark, fill + stroke) are disabled too.
    expect(screen.getByLabelText('Polygon color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode color')).toBeDisabled();
    expect(screen.getByLabelText('Stroke color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode stroke color')).toBeDisabled();
    // The unlock control remains usable.
    const unlock = screen.getByRole('button', { name: 'Unlock polygon' });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(useDoc.getState().polygons['p0'].locked).toBe(false);
  });
});
