import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PolygonPopover } from './PolygonPopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon, makeStyle } from '../test/fixtures';
import { openColorField, setColorField } from '../test/colorField';

const view = { vbX: 0, vbY: 0, vbW: 100, vbH: 100, size: { w: 100, h: 100 } };

// 1:1 world→screen so spawn positions are hand-computable (the 100×100 view
// above is too small for the popover footprint — every spawn pins to the
// margin there, fine for the control tests that ignore position).
const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

// Degenerate point rect for the spawn hint — placement details live in
// screenAnchor.test.ts. Real callers pass polygonAABB(vertices).
const rectAt = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

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
    <PolygonPopover
      polygon={useDoc.getState().polygons['p0']}
      worldRect={rectAt(0, 0)}
      view={view}
      onClose={onClose}
    />,
  );
}

describe('<PolygonPopover />', () => {
  it('lays out the controls top-to-bottom with two section dividers and a "Fill color" label', () => {
    const { container } = renderPopover();
    const body = container.querySelector('.polygon-popover .body') as HTMLElement;
    // Map each body row to a token: dividers to 'divider', control rows to their
    // label text, the footer (no label) to 'footer'. Locks order + divider spots.
    const sequence = Array.from(body.children).map((child) =>
      child.tagName === 'HR' ? 'divider' : (child.querySelector('label')?.textContent ?? 'footer'),
    );
    expect(sequence).toEqual([
      'Style',
      'divider',
      'Fill color',
      'divider',
      'Stroke color',
      'Stroke width',
      'divider',
      'Curve radius',
      'Closed',
      'Layer',
      'footer',
    ]);
  });

  it('renders fill + stroke color pickers, a 0–10 stroke-width control, and Delete', async () => {
    const user = userEvent.setup();
    renderPopover();
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '10');
    expect(slider).toHaveAttribute('step', '0.5');
    const spin = screen.getByRole('spinbutton', { name: 'Stroke width' });
    expect(spin).toBeInTheDocument();
    expect(spin).toHaveAttribute('step', '0.5');
    // Fill + stroke pickers reflect the polygon's colors.
    expect(await openColorField(user, 'Polygon color')).toHaveValue('#112233');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Stroke color')).toHaveValue('#445566');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders dark-mode pickers initialized to the light colors', async () => {
    const user = userEvent.setup();
    renderPopover();
    // Uncustomized fixture → the dark colors equal the light colors.
    expect(await openColorField(user, 'Dark mode color')).toHaveValue('#112233');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Dark mode stroke color')).toHaveValue('#445566');
  });

  it('the dark-mode pickers reflect explicit dark colors when set', async () => {
    const user = userEvent.setup();
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
    expect(await openColorField(user, 'Dark mode color')).toHaveValue('#778899');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Dark mode stroke color')).toHaveValue('#99aabb');
  });

  it('editing the dark-mode fill writes darkFill, leaving the light fill alone', async () => {
    const user = userEvent.setup();
    renderPopover();
    await setColorField(user, 'Dark mode color', '#0a0a0a');
    expect(useDoc.getState().polygons['p0'].darkFill).toBe('#0a0a0a');
    expect(useDoc.getState().polygons['p0'].fill).toBe('#112233');
  });

  it('editing the dark-mode stroke writes darkStroke, leaving the light stroke alone', async () => {
    const user = userEvent.setup();
    renderPopover();
    await setColorField(user, 'Dark mode stroke color', '#0b0b0b');
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

  it('the stroke-width box shows one decimal and the wheel steps by 0.5', () => {
    renderPopover(); // strokeWidth 2
    const spin = screen.getByRole('spinbutton', { name: 'Stroke width' }) as HTMLInputElement;
    expect(spin.value).toBe('2.0');
    fireEvent.wheel(spin, { deltaY: -1 });
    expect(useDoc.getState().polygons['p0'].strokeWidth).toBe(2.5);
    fireEvent.change(screen.getByRole('slider', { name: 'Stroke width' }), {
      target: { value: '3.5' },
    });
    expect(useDoc.getState().polygons['p0'].strokeWidth).toBe(3.5);
  });

  it('Delete removes the polygon and calls onClose', () => {
    const onClose = vi.fn();
    renderPopover(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().polygons['p0']).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('dragging the header moves the popover by the pointer delta', () => {
    const { container } = render(
      <PolygonPopover
        polygon={useDoc.getState().polygons['p0']}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.polygon-popover') as HTMLElement;
    const header = container.querySelector('.polygon-popover .header') as HTMLElement;
    // Point (0,0) → point + 14 gap diagonal.
    expect(parseFloat(popover.style.left)).toBeCloseTo(14, 9);
    expect(parseFloat(popover.style.top)).toBeCloseTo(14, 9);
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(header, { clientX: 130, clientY: 120 });
    expect(parseFloat(popover.style.left)).toBeCloseTo(44, 9); // 14 + 30
    expect(parseFloat(popover.style.top)).toBeCloseTo(34, 9); // 14 + 20
  });

  it('keeps a dragged popover pinned to the canvas when zooming', () => {
    // Regression: any offset held in screen pixels and added on top of the
    // live-projected anchor detaches the popover from the canvas under zoom —
    // this bit the header drag first, then the 14px spawn gap itself (the
    // wandering-popovers bug). Everything now lives in the frozen WORLD point,
    // so the whole popover position — spawn gap included — scales with the map.
    const polygon = useDoc.getState().polygons['p0'];
    const { container, rerender } = render(
      <PolygonPopover
        polygon={polygon}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.polygon-popover') as HTMLElement;
    const header = container.querySelector('.polygon-popover .header') as HTMLElement;

    // Move the popover +30/+20 screen px at zoom 1 (→ world drag of 30/20).
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(header, { clientX: 30, clientY: 20 });
    fireEvent.pointerUp(header, { clientX: 30, clientY: 20 });
    expect(parseFloat(popover.style.left)).toBeCloseTo(44, 9); // 14 + 30
    expect(parseFloat(popover.style.top)).toBeCloseTo(34, 9); // 14 + 20

    // Zoom 2× about the world origin. The corner sits on world point
    // (14,8)+drag(30,20) = (44,28), which now projects to (88,56) — the whole
    // offset doubles with the canvas; nothing stays a fixed pixel size.
    const zoom2 = { vbX: 0, vbY: 0, vbW: 400, vbH: 300, size: { w: 800, h: 600 } };
    rerender(
      <PolygonPopover polygon={polygon} worldRect={rectAt(0, 0)} view={zoom2} onClose={() => {}} />,
    );
    expect(parseFloat(popover.style.left)).toBeCloseTo(88, 9);
    expect(parseFloat(popover.style.top)).toBeCloseTo(68, 9);
  });

  it('re-freezes the spawn when a different polygon is selected', () => {
    // MapCanvas renders one <PolygonPopover> with no per-polygon key, so
    // selecting a different polygon reuses this instance. The frozen spawn
    // must re-freeze to the new polygon — otherwise a far-away polygon's
    // controls anchor at the previously selected polygon's position.
    const left = makePolygon({ id: 'p0' });
    const { container, rerender } = render(
      <PolygonPopover
        polygon={left}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.polygon-popover') as HTMLElement;
    expect(parseFloat(popover.style.left)).toBeCloseTo(14, 9); // point + 14 gap diagonal
    expect(parseFloat(popover.style.top)).toBeCloseTo(14, 9);

    const right = makePolygon({ id: 'p1' });
    rerender(
      <PolygonPopover
        polygon={right}
        worldRect={rectAt(70, 50)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(parseFloat(popover.style.left)).toBeCloseTo(84, 9); // 70 + 14
    expect(parseFloat(popover.style.top)).toBeCloseTo(64, 9); // 50 + 14
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

  it('the Closed checkbox is checked by default and unchecking writes closed: false', () => {
    renderPopover();
    const box = screen.getByRole('checkbox', { name: 'Closed' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(useDoc.getState().polygons['p0'].closed).toBe(false);
  });

  it('re-checking Closed restores a closed polygon', () => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', closed: false }) },
      polygonOrder: ['p0'],
    });
    renderPopover();
    const box = screen.getByRole('checkbox', { name: 'Closed' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(useDoc.getState().polygons['p0'].closed).toBe(true);
  });

  it('when open, the fill controls are disabled but stroke controls stay active', () => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', closed: false }) },
      polygonOrder: ['p0'],
    });
    renderPopover();
    // Fill has no effect on a stroke-only shape.
    expect(screen.getByLabelText('Polygon color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode color')).toBeDisabled();
    // Everything stroke-related (and the checkbox itself) remains editable.
    expect(screen.getByLabelText('Stroke color')).toBeEnabled();
    expect(screen.getByLabelText('Dark mode stroke color')).toBeEnabled();
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeEnabled();
    expect(screen.getByRole('slider', { name: 'Curve radius' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Closed' })).toBeEnabled();
  });

  it('when locked, the Closed checkbox is disabled like the other editing controls', () => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
      polygonOrder: ['p0'],
    });
    renderPopover();
    expect(screen.getByRole('checkbox', { name: 'Closed' })).toBeDisabled();
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

describe('<PolygonPopover /> — style presets', () => {
  // The real mount (ItemPopovers) passes the live store polygon; mirror that
  // so the Style row re-derives when an action writes the tag.
  function LivePopover() {
    const polygon = useDoc((s) => s.polygons['p0']);
    return polygon ? (
      <PolygonPopover polygon={polygon} worldRect={rectAt(0, 0)} view={view} onClose={() => {}} />
    ) : null;
  }

  it('applies a preset from the Style row, then flips to Custom on a covered edit', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        y1: makeStyle('polygon', 'y1', {
          name: 'Lake',
          props: { fill: '#00aaff', curveRadius: 8 },
        }),
      },
    });
    render(<LivePopover />);
    const select = screen.getByRole('combobox', { name: 'Style' });
    fireEvent.change(select, { target: { value: 'y1' } });
    expect(useDoc.getState().polygons['p0']).toMatchObject({
      fill: '#00aaff',
      curveRadius: 8,
      styleId: 'y1',
    });
    expect(select).toHaveValue('y1');
    // A covered edit (closed) detaches back to Custom.
    fireEvent.click(screen.getByLabelText('Closed'));
    expect(useDoc.getState().polygons['p0'].styleId).toBeUndefined();
    expect(select).toHaveValue('__custom__');
  });
});
