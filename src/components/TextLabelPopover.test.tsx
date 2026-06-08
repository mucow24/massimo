import { describe, it, expect, beforeEach } from 'vitest';
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
