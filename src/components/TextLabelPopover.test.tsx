import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

describe('<TextLabelPopover /> — anchor freezes at mount', () => {
  // Regression: an earlier version recomputed the popover position from the
  // anchor prop every render. Combined with upper-left-preserving label
  // resize, dragging the fontSize slider moved the label's screen position,
  // moved the popover under the user's pointer, mapped to a new slider
  // value, and looped — the slider exploded to max. The fix freezes the
  // anchor on first render.
  it('keeps left/top constant when the anchor prop changes after mount', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover label={label} anchor={{ x: 100, y: 200 }} onClose={() => {}} />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const before = positionOf(popover);
    rerender(
      <TextLabelPopover label={label} anchor={{ x: 500, y: 600 }} onClose={() => {}} />,
    );
    const after = positionOf(popover);
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
  });
});
