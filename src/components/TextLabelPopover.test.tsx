import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextLabelPopover } from './TextLabelPopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

const positionOf = (el: HTMLElement) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
});

// A 1:1 world→screen projection so positions are easy to reason about:
// screenX = ((worldX - 0) / 800) * 800 = worldX.
const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

describe('<TextLabelPopover /> — world position freezes, viewport tracks live', () => {
  // Regression: an earlier version recomputed the popover position from the
  // label's live screen position every render. Combined with upper-left-
  // preserving label resize, dragging the fontSize slider moved the label's
  // screen position, moved the popover under the user's pointer, mapped to a
  // new slider value, and looped — the slider exploded to max. The fix freezes
  // the label's *world* position on first render.
  it('keeps left/top constant when the label world position changes after mount', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={label}
        world={{ x: 100, y: 200 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const before = positionOf(popover);
    rerender(
      <TextLabelPopover
        label={label}
        world={{ x: 500, y: 600 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const after = positionOf(popover);
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
  });

  // The popover must follow canvas pan/zoom: the frozen world point projects
  // through the *live* viewport, so a viewport shift moves the popover.
  it('moves left/top when the viewport pans (frozen world projected live)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={label}
        world={{ x: 100, y: 200 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const before = positionOf(popover);
    // Pan the viewBox 50 world units right / 30 down: screen anchor shifts by
    // the negative of that (the world point slides up-left under the viewport).
    rerender(
      <TextLabelPopover
        label={label}
        world={{ x: 100, y: 200 }}
        view={{ ...identityView, vbX: 50, vbY: 30 }}
        onClose={() => {}}
      />,
    );
    const after = positionOf(popover);
    expect(after.left).toBe(before.left - 50);
    expect(after.top).toBe(before.top - 30);
  });

  // Regression: selecting a *different* label reuses the same popover instance
  // (MapCanvas renders one <TextLabelPopover> with no per-label key). The frozen
  // world must re-freeze to the new label, or the popover anchors at the old
  // label's position — e.g. a far-right label's controls appearing next to the
  // far-left label you clicked first.
  it('re-freezes to the new world when a different label is selected', () => {
    const left = makeTextLabel({ id: 'g1', text: 'L' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={left}
        world={{ x: 100, y: 100 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    expect(positionOf(popover)).toEqual({ left: 114, top: 114 }); // 100 + 14 base offset

    const right = makeTextLabel({ id: 'g2', text: 'R' });
    rerender(
      <TextLabelPopover
        label={right}
        world={{ x: 700, y: 500 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(positionOf(popover)).toEqual({ left: 714, top: 514 }); // tracks the new label
  });

  // Regression: the header-drag offset used to be stored in screen pixels and
  // added on top of the live-projected anchor, so zooming after a move left the
  // dragged offset a fixed pixel size while the anchor scaled — the popover slid
  // relative to the canvas. Storing the drag in world space makes the moved
  // offset track zoom exactly like the anchor.
  it('keeps a dragged popover pinned to the canvas when zooming', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={label}
        world={{ x: 0, y: 0 }} // anchor at the origin → screen (0,0)
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const header = container.querySelector('.text-label-popover .header') as HTMLElement;

    // Move the popover +30/+20 screen px at zoom 1 (→ world drag of 30/20).
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(header, { clientX: 30, clientY: 20 });
    fireEvent.pointerUp(header, { clientX: 30, clientY: 20 });
    expect(positionOf(popover)).toEqual({ left: 44, top: 34 }); // 14 + 30 / 14 + 20

    // Zoom 2× centered on the anchor (world origin stays at screen 0,0). The
    // dragged offset must double with the canvas — not stay a fixed 30/20 px.
    const zoom2 = { vbX: 0, vbY: 0, vbW: 400, vbH: 300, size: { w: 800, h: 600 } };
    rerender(
      <TextLabelPopover label={label} world={{ x: 0, y: 0 }} view={zoom2} onClose={() => {}} />,
    );
    expect(positionOf(popover)).toEqual({ left: 74, top: 54 }); // 14 + 60 / 14 + 40
  });
});

describe('<TextLabelPopover /> — day/night color pickers', () => {
  function seedAndRender(
    label = makeTextLabel({ id: 'g1', color: '#112233', darkColor: '#445566' }),
  ) {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
    });
    return render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  it('renders day + night pickers initialized to the label colors', () => {
    seedAndRender();
    expect(screen.getByLabelText('Label color')).toHaveValue('#112233');
    expect(screen.getByLabelText('Dark mode label color')).toHaveValue('#445566');
  });

  it('editing the day color writes color, leaving darkColor alone', () => {
    seedAndRender();
    fireEvent.change(screen.getByLabelText('Label color'), { target: { value: '#0a0a0a' } });
    expect(useDoc.getState().textLabels['g1'].color).toBe('#0a0a0a');
    expect(useDoc.getState().textLabels['g1'].darkColor).toBe('#445566');
  });

  it('editing the night color writes darkColor, leaving color alone', () => {
    seedAndRender();
    fireEvent.change(screen.getByLabelText('Dark mode label color'), {
      target: { value: '#fafafa' },
    });
    expect(useDoc.getState().textLabels['g1'].darkColor).toBe('#fafafa');
    expect(useDoc.getState().textLabels['g1'].color).toBe('#112233');
  });
});

describe('<TextLabelPopover /> — text / size / align / weight controls', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seedAndRender(onClose = () => {}) {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', fontSize: 16, weight: 400, align: 'left' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={onClose}
      />,
    );
  }

  it('edits the label text', () => {
    seedAndRender();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    expect(useDoc.getState().textLabels['g1'].text).toBe('Hello');
  });

  it('changes the font size via the range slider', () => {
    seedAndRender();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '24' } });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(24);
  });

  it('the size slider and spinbutton step by 0.5 and the box shows one decimal', () => {
    seedAndRender();
    const slider = screen.getByRole('slider') as HTMLInputElement;
    const spin = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(slider.getAttribute('step')).toBe('0.5');
    expect(spin.getAttribute('step')).toBe('0.5');
    expect(spin.value).toBe('16.0');
  });

  it('writes half-point sizes via the wheel and the slider', () => {
    seedAndRender();
    fireEvent.wheel(screen.getByRole('spinbutton'), { deltaY: -1 });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.5);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20.5' } });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(20.5);
  });

  it('changes alignment and toggles italic', () => {
    seedAndRender();
    fireEvent.click(screen.getByLabelText('Align center'));
    expect(useDoc.getState().textLabels['g1'].align).toBe('center');
    fireEvent.click(screen.getByLabelText('Italic'));
    expect(useDoc.getState().textLabels['g1'].italic).toBe(true);
  });

  it('changes the weight via the dropdown', () => {
    seedAndRender();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '700' } });
    expect(useDoc.getState().textLabels['g1'].weight).toBe(700);
  });

  it('deletes the label and closes', () => {
    const onClose = vi.fn();
    seedAndRender(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().textLabels['g1']).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<TextLabelPopover /> — lock toggle', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seedAndRender(label = makeTextLabel({ id: 'g1', text: 'Hi' })) {
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  it('the lock toggle flips locked', () => {
    seedAndRender();
    fireEvent.click(screen.getByRole('button', { name: 'Lock label' }));
    expect(useDoc.getState().textLabels['g1'].locked).toBe(true);
  });

  it('when locked, editing controls are disabled but the lock toggle stays active', () => {
    seedAndRender(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByLabelText('Align center')).toBeDisabled();
    expect(screen.getByLabelText('Italic')).toBeDisabled();
    expect(screen.getByLabelText('Label color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode label color')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    // The unlock control remains usable.
    const unlock = screen.getByRole('button', { name: 'Unlock label' });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(useDoc.getState().textLabels['g1'].locked).toBe(false);
  });
});

// Header drag (incl. across zoom) is covered by the world-position describe above.
describe('<TextLabelPopover /> — escape handling', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seedAndRender(onClose = () => {}) {
    const label = makeTextLabel({ id: 'g1', text: 'Hi' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    const { container } = render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        world={{ x: 0, y: 0 }}
        view={identityView}
        onClose={onClose}
      />,
    );
    return { container };
  }

  it('closes on Escape pressed outside a form field', () => {
    const onClose = vi.fn();
    seedAndRender(onClose);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close on Escape while focused in a field', () => {
    const onClose = vi.fn();
    seedAndRender(onClose);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
