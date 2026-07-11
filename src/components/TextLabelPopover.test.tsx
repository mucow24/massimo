import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextLabelPopover } from './TextLabelPopover';
import { useDoc } from '../state/store';
import { useLabelEditorPrefs } from '../state/labelEditorPrefs';
import { DEFAULT_DOC } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';
import { openColorField, setColorField } from '../test/colorField';

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

// Degenerate point rect: keeps the spawn arithmetic one-point simple (the
// popover opens gap-right of the point, top-aligned). Real callers pass the
// label's world AABB (ItemPopovers → textLabelAABB).
const rectAt = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

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
        worldRect={rectAt(100, 200)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const before = positionOf(popover);
    rerender(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(500, 600)}
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
        worldRect={rectAt(100, 200)}
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
        worldRect={rectAt(100, 200)}
        view={{ ...identityView, vbX: 50, vbY: 30 }}
        onClose={() => {}}
      />,
    );
    const after = positionOf(popover);
    expect(after.left).toBeCloseTo(before.left - 50, 9);
    expect(after.top).toBeCloseTo(before.top - 30, 9);
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
        worldRect={rectAt(100, 100)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    expect(positionOf(popover).left).toBeCloseTo(114, 9); // point + 14 gap diagonal
    expect(positionOf(popover).top).toBeCloseTo(114, 9);

    const right = makeTextLabel({ id: 'g2', text: 'R' });
    rerender(
      <TextLabelPopover
        label={right}
        worldRect={rectAt(700, 500)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    // Tracks the new label, placed fully inside the 800×600 host AND off the
    // point: the clamped right/below spots (544,344) would cover (700,500),
    // so the spawn flips left — 700−14−248 = 438; y clamps to 600−248−8 = 344.
    expect(positionOf(popover).left).toBeCloseTo(438, 9);
    expect(positionOf(popover).top).toBeCloseTo(344, 9);
  });

  // A label selected near the host's bottom-right corner would put the popover
  // (240px wide, overflow:hidden host) entirely off-screen. Initial placement
  // clamps into view; the clamp is baked into the frozen world point, so
  // pan/zoom tracking and drags behave exactly as from any other spawn point.
  it('clamps the spawn position into the host near the canvas edge', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container } = render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(790, 590)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    // Clamped right/below spots cover the corner point; left of it clears:
    // 790−14−248 = 528, y clamps to 344.
    expect(positionOf(popover).left).toBeCloseTo(528, 9);
    expect(positionOf(popover).top).toBeCloseTo(344, 9);
  });

  // Regression guard: at zero host size (first paint before measurement) there
  // is no screen↔world mapping, so the spawn must not freeze — inverting a
  // 0-sized viewport is a division by zero that would poison the frozen anchor
  // permanently. The spawn defers to the first measured render and places
  // (gap + clamp) against that real view.
  it('defers the spawn while the host has no size, then places against the real view', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(790, 590)}
        view={{ vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 0, h: 0 } }}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    // Unfrozen fallback (nothing is visible in a 0-px host anyway): plain
    // projection + gap, and crucially no NaN. The deferred (measuring) shell
    // must not paint this placeholder position — visibility hides it.
    expect(positionOf(popover)).toEqual({ left: 14, top: 14 });
    expect(popover).not.toBeVisible();
    // Host measured: the deferred spawn runs now, placed into the real box —
    // same flip-left arithmetic as the edge-spawn test: (528, 344).
    rerender(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(790, 590)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(positionOf(popover).left).toBeCloseTo(528, 9);
    expect(positionOf(popover).top).toBeCloseTo(344, 9);
    expect(popover).toBeVisible();
  });

  it('an id switch mid-drag abandons the captured drag (no stale offset on the new spawn)', () => {
    // The pointer can still be captured on the header when the selection
    // switches to another label (same reused component instance). The old
    // drag's accumulated offset must not re-apply to the new item's fresh
    // spawn on the next pointermove.
    const a = makeTextLabel({ id: 'g1', text: 'A' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={a}
        worldRect={rectAt(100, 100)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const header = container.querySelector('.text-label-popover .header') as HTMLElement;
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(header, { clientX: 30, clientY: 20 });
    expect(positionOf(popover).left).toBeCloseTo(144, 9); // dragging normally

    const b = makeTextLabel({ id: 'g2', text: 'B' });
    rerender(
      <TextLabelPopover
        label={b}
        worldRect={rectAt(400, 300)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(positionOf(popover).left).toBeCloseTo(414, 9); // fresh spawn for g2
    expect(positionOf(popover).top).toBeCloseTo(314, 9);
    // The still-captured pointer keeps moving: must be a no-op now.
    fireEvent.pointerMove(header, { clientX: 90, clientY: 90 });
    expect(positionOf(popover).left).toBeCloseTo(414, 9);
    expect(positionOf(popover).top).toBeCloseTo(314, 9);
  });

  it('measures the shell AFTER the persisted textarea height is applied', () => {
    // usePersistedTextareaHeight applies label.editorHeight in a layout
    // effect; the spawn-measuring effect must run after it (hook-call order)
    // or a stretched text box is placed for its default height and paints
    // past the host bottom. Stub layout-aware measurement: the shell reports
    // 100px of chrome plus the textarea's applied inline height.
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('text-label-popover') ? 240 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('text-label-popover')) return 0;
        const ta = this.querySelector('textarea');
        const h = ta && ta.style.height ? parseFloat(ta.style.height) : 44;
        return 100 + h;
      },
    });
    try {
      const label = makeTextLabel({ id: 'g1', text: 'X', editorHeight: 400 });
      const { container } = render(
        <TextLabelPopover
          label={label}
          worldRect={rectAt(400, 300)}
          view={identityView}
          onClose={() => {}}
        />,
      );
      const popover = container.querySelector('.text-label-popover') as HTMLElement;
      // Measured 240×500 (100 chrome + 400 restored height): diagonal spawn
      // (414,314) clamps y to 600−500−8 = 92. Measuring before the height
      // restore would see 240×144 and leave y at 314.
      expect(positionOf(popover).left).toBeCloseTo(414, 9);
      expect(positionOf(popover).top).toBeCloseTo(92, 9);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
    }
  });

  it('a header drag can still push the popover past the host edge (clamp is spawn-only)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container } = render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(500, 300)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const header = container.querySelector('.text-label-popover .header') as HTMLElement;
    expect(positionOf(popover).left).toBeCloseTo(514, 9); // point + 14 gap diagonal
    expect(positionOf(popover).top).toBeCloseTo(314, 9);
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(header, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(header, { clientX: 200, clientY: 100 });
    expect(positionOf(popover).left).toBeCloseTo(714, 9); // past the x-limit of 544
    expect(positionOf(popover).top).toBeCloseTo(414, 9);
  });

  // Regression: any offset held in screen pixels and added on top of the
  // live-projected anchor detaches the popover from the canvas under zoom —
  // this bit the header drag first, then the 14px spawn gap itself (the
  // wandering-popovers bug). Everything now lives in the frozen WORLD point,
  // so the whole popover position — spawn gap included — scales with the map.
  it('keeps a dragged popover pinned to the canvas when zooming', () => {
    const label = makeTextLabel({ id: 'g1', text: 'X' });
    const { container, rerender } = render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(0, 0)} // anchor at the origin → screen (0,0)
        view={identityView}
        onClose={() => {}}
      />,
    );
    const popover = container.querySelector('.text-label-popover') as HTMLElement;
    const header = container.querySelector('.text-label-popover .header') as HTMLElement;

    // Spawn: point + 14 gap diagonal. Move it +30/+20 screen px at zoom 1
    // (→ world drag of 30/20).
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(header, { clientX: 30, clientY: 20 });
    fireEvent.pointerUp(header, { clientX: 30, clientY: 20 });
    expect(positionOf(popover).left).toBeCloseTo(44, 9); // 14 + 30
    expect(positionOf(popover).top).toBeCloseTo(34, 9); // 14 + 20

    // Zoom 2× about the world origin. The corner sits on world point
    // (14,14)+drag(30,20) = (44,34), which now projects to (88,68) — the whole
    // offset doubles with the canvas; nothing stays a fixed pixel size.
    const zoom2 = { vbX: 0, vbY: 0, vbW: 400, vbH: 300, size: { w: 800, h: 600 } };
    rerender(
      <TextLabelPopover label={label} worldRect={rectAt(0, 0)} view={zoom2} onClose={() => {}} />,
    );
    expect(positionOf(popover).left).toBeCloseTo(88, 9);
    expect(positionOf(popover).top).toBeCloseTo(68, 9);
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
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  it('renders day + night pickers initialized to the label colors', async () => {
    const user = userEvent.setup();
    seedAndRender();
    expect(await openColorField(user, 'Label color')).toHaveValue('#112233');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Dark mode label color')).toHaveValue('#445566');
  });

  it('editing the day color writes color, leaving darkColor alone', async () => {
    const user = userEvent.setup();
    seedAndRender();
    await setColorField(user, 'Label color', '#0a0a0a');
    expect(useDoc.getState().textLabels['g1'].color).toBe('#0a0a0a');
    expect(useDoc.getState().textLabels['g1'].darkColor).toBe('#445566');
  });

  it('editing the night color writes darkColor, leaving color alone', async () => {
    const user = userEvent.setup();
    seedAndRender();
    await setColorField(user, 'Dark mode label color', '#fafafa');
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
        worldRect={rectAt(0, 0)}
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

  it('lays out the controls top-to-bottom with two section dividers (Text stays pinned at top)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', fontSize: 16, weight: 400, align: 'left' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    const { container } = render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const body = container.querySelector('.text-label-popover .body') as HTMLElement;
    // Map each body row to a token: dividers to 'divider', control rows to their
    // label text, the footer (no label) to 'footer'. Locks order + divider spots.
    const sequence = Array.from(body.children).map((child) =>
      child.tagName === 'HR' ? 'divider' : (child.querySelector('label')?.textContent ?? 'footer'),
    );
    expect(sequence).toEqual([
      'Text',
      'Wrap',
      'Color',
      'Size',
      'Weight',
      'divider',
      'Align',
      'Width',
      'divider',
      'Leading',
      'Tracking',
      'footer',
    ]);
  });

  it('changes the font size via the range slider', () => {
    seedAndRender();
    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '24' } });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(24);
  });

  it('the size slider and spinbutton step by 0.25 and the box shows two decimals', () => {
    seedAndRender();
    const slider = screen.getByRole('slider', { name: 'Size' }) as HTMLInputElement;
    const spin = screen.getByRole('spinbutton', { name: 'Size' }) as HTMLInputElement;
    expect(slider.getAttribute('step')).toBe('0.25');
    expect(spin.getAttribute('step')).toBe('0.25');
    expect(spin.value).toBe('16.00');
  });

  it('writes quarter-point sizes via the wheel and the slider', () => {
    seedAndRender();
    fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Size' }), { deltaY: -1 });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.25);
    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '20.5' } });
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

describe('<TextLabelPopover /> — leading + tracking', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seedAndRender() {
    const label = makeTextLabel({ id: 'g1', text: 'Hi\nThere' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  it('sets leading via its slider ([0,2] range, 0.05 step)', () => {
    seedAndRender();
    const slider = screen.getByRole('slider', { name: 'Leading' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('2');
    expect(slider.getAttribute('step')).toBe('0.05');
    expect(slider.value).toBe('1'); // default
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(useDoc.getState().textLabels['g1'].leading).toBe(1.5);
  });

  it('sets tracking via its slider ([-0.1,0.5] range, 0.001 step)', () => {
    seedAndRender();
    const slider = screen.getByRole('slider', { name: 'Tracking' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('-0.1');
    expect(slider.getAttribute('max')).toBe('0.5');
    expect(slider.getAttribute('step')).toBe('0.001');
    expect(slider.value).toBe('0'); // default
    fireEvent.change(slider, { target: { value: '0.25' } });
    expect(useDoc.getState().textLabels['g1'].tracking).toBe(0.25);
  });

  it('marks the neutral values with a detent tick', () => {
    seedAndRender();
    for (const [name, neutral] of [
      ['Leading', '1'],
      ['Tracking', '0'],
    ] as const) {
      const slider = screen.getByRole('slider', { name });
      const listId = slider.getAttribute('list');
      expect(listId).toBeTruthy();
      const tick = document.getElementById(listId!)?.querySelector('option');
      expect(tick?.getAttribute('value')).toBe(neutral);
    }
  });

  it('disables both rows when locked', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', locked: true });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Leading' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Tracking' })).toBeDisabled();
  });
});

describe('<TextLabelPopover /> — lock toggle', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seedAndRender(label = makeTextLabel({ id: 'g1', text: 'Hi' })) {
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        worldRect={rectAt(0, 0)}
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
    expect(screen.getByRole('slider', { name: 'Size' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Size' })).toBeDisabled();
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

describe('<TextLabelPopover /> — column width + justify', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  function seed(label = makeTextLabel({ id: 'g1', text: 'Hi', align: 'left' })) {
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  it('offers a justify alignment button', () => {
    seed();
    fireEvent.click(screen.getByLabelText('Justify'));
    expect(useDoc.getState().textLabels['g1'].align).toBe('justify');
  });

  it('sets a column width via the width slider', () => {
    seed();
    fireEvent.change(screen.getByRole('slider', { name: 'Width' }), { target: { value: '220' } });
    expect(useDoc.getState().textLabels['g1'].width).toBe(220);
  });

  it('shows width 0 (Auto) for a label with no width', () => {
    seed();
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toHaveValue(0);
  });

  it('disables the width controls when locked', () => {
    seed(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    expect(screen.getByRole('slider', { name: 'Width' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeDisabled();
  });

  it('wheel over a locked label’s size/width rows leaves the label unchanged', () => {
    // The row-level wheel handler must respect the lock — both inputs are
    // disabled, so a wheel notch anywhere in the row must not edit the label.
    seed(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    const before = useDoc.getState().textLabels['g1'];
    fireEvent.wheel(screen.getByRole('slider', { name: 'Size' }), { deltaY: -1 });
    fireEvent.wheel(screen.getByRole('slider', { name: 'Width' }), { deltaY: -1 });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(before.fontSize);
    expect(useDoc.getState().textLabels['g1'].width).toBe(before.width);
  });
});

describe('<TextLabelPopover /> — wrap-lines toggle (persisted editor preference)', () => {
  const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

  beforeEach(() => {
    // The wrap flag is a global persisted preference, not doc state — reset both
    // the store and its localStorage backing so tests don't leak into each other
    // or into the other describes in this file.
    localStorage.clear();
    useLabelEditorPrefs.setState({ wrapText: false });
  });

  function seedAndRender() {
    const label = makeTextLabel({ id: 'g1', text: 'Hi' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
  }

  // The wrap toggle drives a CSS class, not the textarea's `wrap` attribute:
  // Chromium ignores post-creation changes to `wrap`, and the base stylesheet
  // pins `white-space: pre`, so the `.wrap` class is what actually flips it.
  it('defaults to unchecked with no wrap class (unchanged legacy behavior)', () => {
    seedAndRender();
    expect(screen.getByRole('checkbox', { name: 'Wrap' })).not.toBeChecked();
    expect(screen.getByRole('textbox')).not.toHaveClass('wrap');
  });

  it('checking it adds the wrap class and writes the persisted preference', () => {
    seedAndRender();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap' }));
    expect(screen.getByRole('textbox')).toHaveClass('wrap');
    expect(useLabelEditorPrefs.getState().wrapText).toBe(true);
  });

  it('reflects an already-remembered preference when the popover opens', () => {
    useLabelEditorPrefs.setState({ wrapText: true });
    seedAndRender();
    expect(screen.getByRole('checkbox', { name: 'Wrap' })).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveClass('wrap');
  });

  it('stays usable on a locked label (view-only preference, never mutates the label)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', locked: true });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={label}
        worldRect={rectAt(0, 0)}
        view={identityView}
        onClose={() => {}}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Wrap' });
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(useLabelEditorPrefs.getState().wrapText).toBe(true);
  });
});

// Header drag (incl. across zoom) is covered by the world-position describe
// above. Escape handling (close on Esc, but not while typing in a field)
// lives in App's global keydown handler — covered in App.keyboard.test.tsx.
