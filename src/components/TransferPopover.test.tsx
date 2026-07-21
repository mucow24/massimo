import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransferPopover } from './TransferPopover';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStation, makeStyle, makeTransfer } from '../test/fixtures';
import { openColorField, setColorField } from '../test/colorField';
import { chooseOption, stepSlider } from '../test/interaction';

const view = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

// Degenerate point rect for the spawn hint — placement details live in
// screenAnchor.test.ts, and the capsule rect itself in itemBounds.test.ts;
// here the point keeps positions easy to reason about.
const rectAt = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: {
      s1: makeStation({ id: 's1', x: 0, y: 0 }),
      s2: makeStation({ id: 's2', x: 200, y: 0 }),
    },
    transfers: { x1: makeTransfer({ id: 'x1' }) },
  });
  useDoc.temporal.getState().clear();
});

function renderPopover(onClose = () => {}) {
  return render(
    <TransferPopover
      transfer={useDoc.getState().transfers['x1']}
      worldRect={rectAt(100, 0)}
      view={view}
      onClose={onClose}
    />,
  );
}

describe('<TransferPopover />', () => {
  it('lays out the controls top-to-bottom with a divider between body and stroke', () => {
    const { container } = renderPopover();
    const body = container.querySelector('.transfer-popover .body') as HTMLElement;
    const sequence = Array.from(body.children).map((child) =>
      child.tagName === 'HR' ? 'divider' : (child.querySelector('label')?.textContent ?? 'footer'),
    );
    expect(sequence).toEqual([
      'Style',
      'divider',
      'Thickness',
      'Color',
      'divider',
      'Stroke width',
      'Stroke color',
      'footer',
    ]);
  });

  it('shows the EFFECTIVE values — the constant defaults for an override-free transfer', async () => {
    const user = userEvent.setup();
    renderPopover();
    expect(screen.getByRole('slider', { name: 'Thickness' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('spinbutton', { name: 'Thickness' })).toHaveValue(2);
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(await openColorField(user, 'Transfer color')).toHaveValue('#000000');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Transfer stroke color')).toHaveValue('#ffffff');
  });

  it('shows the override values when present (day + night swatches)', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      transfers: {
        x1: makeTransfer({ id: 'x1', thickness: 6, color: { day: '#ff8800', night: '#4400aa' } }),
      },
    });
    renderPopover();
    expect(screen.getByRole('slider', { name: 'Thickness' })).toHaveAttribute('aria-valuenow', '6');
    expect(await openColorField(user, 'Transfer color')).toHaveValue('#ff8800');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Transfer dark color')).toHaveValue('#4400aa');
  });

  it('editing the thickness writes a per-transfer override', () => {
    renderPopover();
    // One 0.25 arrow step from the effective default (2) → 2.25, stored as an override.
    stepSlider(screen.getByRole('slider', { name: 'Thickness' }), 1);
    expect(useDoc.getState().transfers.x1.thickness).toBe(2.25);
  });

  it('choosing the constant default CLEARS the override (never stored)', () => {
    useDoc.setState({
      ...useDoc.getState(),
      transfers: { x1: makeTransfer({ id: 'x1', thickness: 7 }) },
    });
    renderPopover();
    // Type the constant default (2) into the paired spinbutton.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Thickness' }), {
      target: { value: '2' },
    });
    expect('thickness' in useDoc.getState().transfers.x1).toBe(false);
  });

  it('editing the DAY color swatch writes that half; the night half stays at its effective value', async () => {
    const user = userEvent.setup();
    renderPopover();
    await setColorField(user, 'Transfer color', '#ff0080');
    // Day takes the new color; night tracked the default (#000000) and is kept.
    expect(useDoc.getState().transfers.x1.color).toEqual({ day: '#ff0080', night: '#000000' });
    // Back to the default day color → both halves black → the override drops.
    fireEvent.change(screen.getByLabelText('Transfer color hex value'), {
      target: { value: '#000000' },
    });
    expect('color' in useDoc.getState().transfers.x1).toBe(false);
    await user.keyboard('{Escape}');
    await setColorField(user, 'Transfer stroke color', '#123456');
    // Day stroke takes the new color; night tracked the default white and is kept.
    expect(useDoc.getState().transfers.x1.strokeColor).toEqual({
      day: '#123456',
      night: '#ffffff',
    });
  });

  it('editing the NIGHT color swatch writes only that half of the override', async () => {
    const user = userEvent.setup();
    renderPopover();
    await setColorField(user, 'Transfer dark color', '#4400aa');
    // Day still tracks the default black; night takes the new color.
    expect(useDoc.getState().transfers.x1.color).toEqual({ day: '#000000', night: '#4400aa' });
  });

  it('editing the stroke width writes a per-transfer override', () => {
    renderPopover();
    // One arrow step from the effective default (0) → 0.25, stored as an override.
    stepSlider(screen.getByRole('slider', { name: 'Stroke width' }), 1);
    expect(useDoc.getState().transfers.x1.strokeWidth).toBe(0.25);
  });

  it('one wheel notch over a spinbutton steps the EFFECTIVE value exactly once', () => {
    renderPopover();
    fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Thickness' }), { deltaY: -1 });
    // Tracking transfer: effective 2 + 0.25 = 2.25, stored as an override.
    expect(useDoc.getState().transfers.x1.thickness).toBe(2.25);
  });

  it('a wheel notch steps from the OVERRIDE when one is present, not the default', () => {
    useDoc.setState({
      ...useDoc.getState(),
      transfers: { x1: makeTransfer({ id: 'x1', thickness: 6 }) },
    });
    renderPopover();
    fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Thickness' }), { deltaY: -1 });
    // 6 + 0.25, NOT default 2 + 0.25 (which would silently clobber the override).
    expect(useDoc.getState().transfers.x1.thickness).toBe(6.25);
  });

  it('a wheel notch over the Stroke width spinbutton steps the stroke width, not thickness', () => {
    renderPopover();
    fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Stroke width' }), { deltaY: -1 });
    // Tracking transfer: effective 0 + 0.25 = 0.25, stored as a strokeWidth override.
    expect(useDoc.getState().transfers.x1.strokeWidth).toBe(0.25);
    expect('thickness' in useDoc.getState().transfers.x1).toBe(false);
  });

  it('groups a thickness-slider drag into a single undo entry', () => {
    // Successive arrow-key steps need the popover re-rendered with the fresh
    // store transfer between steps (the Radix slider is controlled), so mount
    // it live rather than with the static renderPopover snapshot.
    function LivePopover() {
      const transfer = useDoc((s) => s.transfers['x1']);
      return (
        <TransferPopover
          transfer={transfer}
          worldRect={rectAt(100, 0)}
          view={view}
          onClose={() => {}}
        />
      );
    }
    render(<LivePopover />);
    const slider = screen.getByRole('slider', { name: 'Thickness' });
    const before = historyDepth();
    // A drag: focus opens the field-history group, arrow steps edit, blur
    // commits exactly one entry — same contract the native range had.
    stepSlider(slider, 3);
    fireEvent.blur(slider);
    expect(useDoc.getState().transfers.x1.thickness).toBe(2.75); // effective 2 + 3×0.25 steps
    expect(historyDepth() - before).toBe(1);
  });

  it('Delete removes the transfer and closes; there is no lock button', () => {
    const onClose = vi.fn();
    renderPopover(onClose);
    expect(screen.queryByRole('button', { name: /lock/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().transfers.x1).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('spawns beside the worldRect, frozen at first display (endpoint moves do not slide it)', () => {
    const { container, rerender } = renderPopover();
    const el = container.querySelector('.transfer-popover') as HTMLElement;
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    // Point rect at the capsule midpoint (100,0) → the diagonal spawn
    // candidate (100+14, 0+14), unclamped this far from the edges.
    expect(left).toBeCloseTo(114, 6);
    expect(top).toBeCloseTo(14, 6);
    // An endpoint move re-renders with a fresh worldRect: the frozen anchor
    // must not follow (the rect is a spawn hint only).
    rerender(
      <TransferPopover
        transfer={useDoc.getState().transfers['x1']}
        worldRect={rectAt(400, 300)}
        view={view}
        onClose={() => {}}
      />,
    );
    expect(parseFloat(el.style.left)).toBeCloseTo(left, 6);
    expect(parseFloat(el.style.top)).toBeCloseTo(top, 6);
  });
});

describe('<TransferPopover /> — style presets', () => {
  // The real mount (ItemPopovers) passes the live store transfer; mirror that
  // so the Style row re-derives when an action writes the tag.
  function LivePopover() {
    const transfer = useDoc((s) => s.transfers['x1']);
    return transfer ? (
      <TransferPopover
        transfer={transfer}
        worldRect={rectAt(100, 0)}
        view={view}
        onClose={() => {}}
      />
    ) : null;
  }

  it('applies a preset from the Style row, then flips to Custom on a covered edit', async () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: { y1: makeStyle('transfer', 'y1', { name: 'Bold link', props: { thickness: 6 } }) },
    });
    render(<LivePopover />);
    await chooseOption(userEvent.setup(), 'Style', 'Bold link');
    expect(useDoc.getState().transfers['x1'].styleId).toBe('y1');
    expect(screen.getByRole('slider', { name: 'Thickness' })).toHaveAttribute('aria-valuenow', '6');
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Bold link');
    // A covered edit detaches back to Custom.
    stepSlider(screen.getByRole('slider', { name: 'Thickness' }), 1);
    expect(useDoc.getState().transfers['x1'].styleId).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Custom');
  });
});
