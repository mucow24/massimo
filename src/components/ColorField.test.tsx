import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorField } from './ColorField';
import { useDoc } from '../state/store';

beforeEach(() => {
  localStorage.clear();
  useDoc.temporal.getState().clear();
});

// jsdom has no layout: every rect is zeros, every clientWidth 0, every
// offsetWidth 0. Stub what the placement reads — the swatch's box, the window's
// CLIENT size (what is left beside the scrollbars), and the popover's own
// measured box. `scrollbar` is how far the window's own inner size overshoots
// the client one, which is the whole point: the narrow window that scrolls the
// app sideways carries scrollbars on both axes.
function stubPlacement(o: {
  swatch: { left: number; top: number; bottom: number };
  client: { w: number; h: number };
  scrollbar: number;
  popover: { w: number; h: number };
}): () => void {
  const docEl = document.documentElement;
  const origCW = Object.getOwnPropertyDescriptor(docEl, 'clientWidth');
  const origCH = Object.getOwnPropertyDescriptor(docEl, 'clientHeight');
  // getBoundingClientRect lives on Element; the offset sizes on HTMLElement.
  const origRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
  const origOW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
  const origOH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  const { innerWidth, innerHeight } = window;
  const def = (target: object, prop: string, get: () => number) =>
    Object.defineProperty(target, prop, { configurable: true, get });
  def(docEl, 'clientWidth', () => o.client.w);
  def(docEl, 'clientHeight', () => o.client.h);
  def(window, 'innerWidth', () => o.client.w + o.scrollbar);
  def(window, 'innerHeight', () => o.client.h + o.scrollbar);
  def(HTMLElement.prototype, 'offsetWidth', () => o.popover.w);
  def(HTMLElement.prototype, 'offsetHeight', () => o.popover.h);
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: o.swatch.left,
      right: o.swatch.left + 30,
      top: o.swatch.top,
      bottom: o.swatch.bottom,
      width: 30,
      height: o.swatch.bottom - o.swatch.top,
    }),
  });
  return () => {
    if (origCW) Object.defineProperty(docEl, 'clientWidth', origCW);
    else delete (docEl as unknown as Record<string, unknown>).clientWidth;
    if (origCH) Object.defineProperty(docEl, 'clientHeight', origCH);
    else delete (docEl as unknown as Record<string, unknown>).clientHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', origRect);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOW);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOH);
  };
}

const GAP = 6;

describe('<ColorField /> picker placement', () => {
  it('keeps the picker inside the window, clear of the vertical scrollbar', async () => {
    // The narrow-window regime (see useDock): the app is floored at the
    // toolbar's width, so the page scrolls sideways and — `.app` being 100vh —
    // vertically too. `window.innerWidth` counts that vertical scrollbar;
    // clamping against it parks the picker's right edge under and past it.
    const restore = stubPlacement({
      swatch: { left: 460, top: 78, bottom: 100 },
      client: { w: 500, h: 800 },
      scrollbar: 17,
      popover: { w: 240, h: 280 },
    });
    try {
      const user = userEvent.setup();
      render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" />);
      await user.click(screen.getByLabelText('Test color'));
      const pop = screen.getByRole('dialog');
      // Right-aligned on the picker's OWN measured width, inside the client edge.
      expect(parseFloat(pop.style.left)).toBe(500 - 240 - GAP);
    } finally {
      restore();
    }
  });

  it('flips above the swatch when its measured height will not fit below', async () => {
    const restore = stubPlacement({
      swatch: { left: 40, top: 300, bottom: 322 },
      client: { w: 900, h: 560 },
      scrollbar: 17,
      popover: { w: 240, h: 280 },
    });
    try {
      const user = userEvent.setup();
      render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" />);
      await user.click(screen.getByLabelText('Test color'));
      const pop = screen.getByRole('dialog');
      // 322 + 6 + 280 = 608, past the 560 client bottom — so it opens above.
      expect(parseFloat(pop.style.top)).toBe(300 - GAP - 280);
      expect(parseFloat(pop.style.left)).toBe(40);
    } finally {
      restore();
    }
  });
});

describe('<ColorField />', () => {
  it('opens the picker popover on swatch click and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByLabelText('Test color'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="Test color" disabled />);
    await user.click(screen.getByLabelText('Test color'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('normalizes an opaque hex value to 6 digits before calling onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#112233" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '112233ff');
    // The trailing opaque ff is stripped — stored values stay 6-digit unless a
    // real alpha is chosen (keeps palette-swatch matching working).
    expect(onChange).toHaveBeenLastCalledWith('#112233');
  });

  it('keeps a translucent alpha when the hex carries one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#112233" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '11223380');
    expect(onChange).toHaveBeenLastCalledWith('#11223380');
  });

  it('applies exactly the typed hex when typed char-by-char into a live-bound field', async () => {
    // Regression: react-colorful's HexColorInput re-derives its text from the
    // `color` prop on every change with no focus guard, so a normalizing,
    // live-bound parent reset the field mid-type and a 3-digit short form ('505')
    // expanded to '#550055' and hijacked it. Typing '505050' must land on
    // exactly '#505050'.
    const user = userEvent.setup();
    function Harness() {
      const [c, setC] = useState('#000000');
      return <ColorField value={c} onChange={setC} ariaLabel="Test color" />;
    }
    render(<Harness />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, '505050');
    expect(hex).toHaveValue('#505050');
  });

  it('accepts a 3-digit short form on blur (expands to 6-digit)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} ariaLabel="Test color" />);
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, 'abc');
    // Short form does NOT apply live (would hijack a longer entry)...
    expect(onChange).not.toHaveBeenCalledWith('#aabbcc');
    // ...but commits on blur.
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  });

  it('collapses the whole edit session into one undo group', async () => {
    // Opening the picker pauses history; closing commits exactly one entry
    // regardless of how many onChange ticks the drag produced. A per-tick doc
    // write (setDocName) stands in for the real color write.
    const user = userEvent.setup();
    let ticks = 0;
    const startDepth = useDoc.temporal.getState().pastStates.length;
    render(
      <ColorField
        value="#112233"
        onChange={() => useDoc.getState().setDocName(`tick-${++ticks}`)}
        ariaLabel="Test color"
      />,
    );
    await user.click(screen.getByLabelText('Test color'));
    const hex = screen.getByLabelText('Test color hex value');
    await user.clear(hex);
    await user.type(hex, 'aabbcc');
    expect(ticks).toBeGreaterThan(0); // the picker actually emitted
    // Still open → history is paused → no new past entries yet.
    expect(useDoc.temporal.getState().pastStates.length).toBe(startDepth);
    await user.keyboard('{Escape}');
    // Closing commits ONE grouped entry for the whole session.
    expect(useDoc.temporal.getState().pastStates.length).toBe(startDepth + 1);
  });

  it('addNew renders a "+" add affordance instead of a color chip, and still opens the picker', async () => {
    const user = userEvent.setup();
    render(<ColorField value="#112233" onChange={vi.fn()} ariaLabel="New color" addNew />);
    const btn = screen.getByLabelText('New color');
    expect(btn.classList.contains('add-new')).toBe(true);
    // The "+" glyph, not the value-mirroring chip.
    expect(btn.querySelector('.color-field-add')).not.toBeNull();
    expect(btn.querySelector('.color-field-chip')).toBeNull();
    // The picker still opens (seeded at value).
    await user.click(btn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
